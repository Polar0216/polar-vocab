import { liveQuery } from 'dexie'
import { syncMetadataSchema, type DataSnapshot, type SyncMetadata } from '../../domain'
import { connectionSchema, syncJobSchema, type Connection, type SyncJob } from '../../storage/sync-models'
import { ApiError, GitHubClient, type GitHubTransport, type Target, utf8Size } from '../../integrations/github/client'
import type { LocalVocabularyService } from '../vocabulary/service'
import { decodeSnapshot, encodeSnapshot, logical, ProtocolError } from './protocol'
import { mergeSnapshots } from './merge'
import { writeWorking, replaceConflicts } from './persistence'

export interface ConnectionPreview { id: string; target: Target; local: DataSnapshot; remote: DataSnapshot | null; bytes: number; case: 'A' | 'B' | 'C' | 'D'; conflicts: number }
export class SyncError extends Error { constructor(message: string) { super(message); this.name = 'SyncError' } }
const LEASE_ID = '9465362c-0a48-4e60-9863-345a7eb8fcd7'
const sessions = new WeakMap<LocalVocabularyService, SyncEngine>()
export function syncEngine(service: LocalVocabularyService): SyncEngine { let engine = sessions.get(service); if (!engine) { engine = new SyncEngine(service); sessions.set(service, engine) } return engine }

export class SyncEngine {
  readonly service: LocalVocabularyService
  private transport?: GitHubTransport
  private preview?: { display: ConnectionPreview; transport: GitHubTransport }
  private busy = false
  private readonly holder = crypto.randomUUID()
  private failureCount = 0
  private lastAttempt = 0
  private timer?: ReturnType<typeof setTimeout>
  private stopAuto?: () => void
  private decoded = new Map<string, DataSnapshot>()
  lastError = ''
  constructor(service: LocalVocabularyService) { this.service = service }
  authorized(): boolean { return Boolean(this.transport) }
  async connection(): Promise<Connection | undefined> { await this.service.initialize(); return this.service.db.connections.toCollection().first() }
  async test(input: Omit<Target, 'path'>, token: string, transport: GitHubTransport = new GitHubClient(token)): Promise<ConnectionPreview> {
    this.preview?.transport.clear(); this.preview = undefined
    try {
      const target = await transport.verify({ ...input, path: 'data/state.json' })
      const file = await transport.get(target); const remote = file ? await decodeSnapshot(file.text) : null
      const local = await this.service.snapshot()
      const populated = (s: DataSnapshot) => s.vocabularies.length + s.cards.length + s.reviewEvents.length + s.captures.length + s.tombstones.length > 0
      const display: ConnectionPreview = { id: crypto.randomUUID(), target, local, remote, bytes: utf8Size(file?.text ?? encodeSnapshot(local)), case: populated(local) ? populated(remote ?? local) && remote ? 'D' : 'B' : remote && populated(remote) ? 'C' : 'A', conflicts: remote ? mergeSnapshots(null, local, remote).conflicts.length : 0 }
      this.preview = { display: structuredClone(display), transport }; return display
    } catch (error) { transport.clear(); throw error }
  }
  cancelPreview(): void { this.preview?.transport.clear(); this.preview = undefined }
  async confirm(preview: ConnectionPreview, learningSettings: 'remote' | 'local' = 'remote'): Promise<void> {
    const plan = this.preview
    if (!plan || plan.display.id !== preview.id) throw new SyncError('连接预览已失效，请重新测试。')
    if (logical(await this.service.snapshot()) !== logical(plan.display.local)) throw new SyncError('预览后本机内容已变化，请重新测试连接。')
    this.transport?.clear(); this.transport = undefined; this.stopAuto?.()
    await this.service.transaction(async () => {
      const db = this.service.db; const old = await db.connections.toCollection().first()
      if (old && old.owner === plan.display.target.owner && old.repository === plan.display.target.repository && old.branch === plan.display.target.branch) {
        await db.connections.put({ ...old, authorized: true, retryAt: 0 })
      } else {
        await db.connections.clear(); await db.syncJobs.clear(); await replaceConflicts(db, [])
        await db.connections.add(connectionSchema.parse({ ...plan.display.target, id: crypto.randomUUID(), schemaVersion: 1, auto: false, authorized: true, retryAt: 0, generation: crypto.randomUUID() }))
        const meta = await db.syncMetadata.toCollection().first()
        await db.syncMetadata.put(syncMetadataSchema.parse({ ...meta, baseSnapshotId: null, remoteSha: null, lastSyncedAt: null, status: 'idle', updatedAt: new Date().toISOString(), lastErrorCode: undefined }))
        const remoteSettings = plan.display.remote?.settings
        if (remoteSettings && learningSettings === 'local' && remoteSettings.id !== plan.display.local.settings.id) {
          const adopted = { ...plan.display.local.settings, id: remoteSettings.id, createdAt: remoteSettings.createdAt, revisionId: crypto.randomUUID(), parentRevisionIds: [remoteSettings.revisionId, plan.display.local.settings.revisionId], updatedAt: new Date().toISOString() }
          await db.settings.clear(); await db.settings.add(adopted); await this.service.appendPending('update-settings', adopted)
        }
      }
    })
    this.transport = plan.transport; this.preview = undefined; this.lastError = ''; this.startAuto()
    await this.synchronize()
  }
  async disconnect(): Promise<void> {
    this.transport?.clear(); this.transport = undefined; this.cancelPreview(); this.stopAuto?.(); clearTimeout(this.timer); this.decoded.clear()
    await this.service.transaction(async () => {
      await this.service.db.connections.clear(); await this.service.db.syncJobs.clear(); await this.service.db.syncLeases.clear()
      const metadata = await this.service.db.syncMetadata.toCollection().first()
      await this.service.db.syncMetadata.put(syncMetadataSchema.parse({ ...metadata, status: 'unconfigured', baseSnapshotId: null, remoteSha: null, lastSyncedAt: null, updatedAt: new Date().toISOString(), lastErrorCode: undefined }))
    })
  }
  async setAuto(auto: boolean): Promise<void> { const connection = await this.connection(); if (connection) await this.service.db.connections.put({ ...connection, auto }); if (auto) this.scheduleAuto() }
  private startAuto(): void {
    this.stopAuto?.()
    const subscription = liveQuery(() => this.service.db.pendingOperations.count()).subscribe({ next: () => this.scheduleAuto(), error: () => undefined })
    const trigger = () => this.scheduleAuto()
    const reset = () => { this.transport?.clear(); this.transport = undefined; this.cancelPreview(); clearTimeout(this.timer); this.stopAuto?.() }
    window.addEventListener('online', trigger); window.addEventListener('focus', trigger); document.addEventListener('visibilitychange', trigger); window.addEventListener('polar-vocab-session-ended', trigger)
    window.addEventListener('polar-vocab-storage-reset', reset)
    this.stopAuto = () => { subscription.unsubscribe(); window.removeEventListener('online', trigger); window.removeEventListener('focus', trigger); document.removeEventListener('visibilitychange', trigger); window.removeEventListener('polar-vocab-session-ended', trigger); window.removeEventListener('polar-vocab-storage-reset', reset) }
  }
  private scheduleAuto(): void {
    clearTimeout(this.timer)
    // Trailing batch delay, at least one minute between requests; never one PUT per grade.
    this.timer = setTimeout(() => { void this.autoRun() }, Math.max(15_000, this.lastAttempt + 60_000 - Date.now()))
  }
  private async autoRun(): Promise<void> {
    const connection = await this.connection()
    if (connection?.auto && this.transport && navigator.onLine && document.visibilityState === 'visible' && !this.busy && !await this.service.db.conflicts.count()) {
      if (connection.retryAt > Date.now()) { this.timer = setTimeout(() => { void this.autoRun() }, connection.retryAt - Date.now()); return }
      await this.synchronize().catch(() => { if (this.failureCount < 3) this.scheduleAuto() })
    }
  }
  private async metadata(status: SyncMetadata['status'], code?: SyncMetadata['lastErrorCode']): Promise<void> {
    const db = this.service.db
    await db.transaction('rw', db.syncMetadata, async () => { const current = await db.syncMetadata.toCollection().first(); await db.syncMetadata.put(syncMetadataSchema.parse({ ...current, status, lastErrorCode: code, updatedAt: new Date().toISOString() })) })
  }
  async synchronize(): Promise<'synced' | 'conflict'> {
    if (this.busy) throw new SyncError('当前页面正在同步，请等待。')
    const db = this.service.db; const connection = await this.connection(); const transport = this.transport
    if (!connection || !transport) throw new SyncError('请先输入凭证并测试连接。刷新后需要重新授权。')
    const target: Target = { owner: connection.owner, repository: connection.repository, branch: connection.branch, path: connection.path }
    if (!navigator.onLine) { await this.metadata('pending', 'offline'); throw new SyncError('当前离线，本机修改已保留。') }
    if (connection.retryAt > Date.now()) throw new SyncError(`请在 ${new Date(connection.retryAt).toLocaleTimeString('zh-CN')} 后重试。`)
    await db.transaction('rw', db.syncLeases, async () => {
      const lease = await db.syncLeases.get(LEASE_ID)
      if (lease && lease.expiresAt > Date.now() && lease.holder !== this.holder) throw new SyncError('另一标签页正在同步，请稍后再试。')
      await db.syncLeases.put({ id: LEASE_ID, schemaVersion: 1, holder: this.holder, expiresAt: Date.now() + 90_000 })
    })
    this.busy = true; this.lastAttempt = Date.now(); this.lastError = ''
    const heartbeat = setInterval(() => { void db.transaction('rw', db.syncLeases, async () => { const lease = await db.syncLeases.get(LEASE_ID); if (lease?.holder === this.holder) await db.syncLeases.put({ ...lease, expiresAt: Date.now() + 90_000 }) }).catch(() => undefined) }, 20_000)
    try {
      await this.metadata('syncing')
      const { validateLearningSnapshot } = await import('../review/integrity')
      let job: SyncJob = await this.service.transaction(async () => {
        const existing = await db.syncJobs.toCollection().first()
        if (existing) { if (existing.generation !== connection.generation) throw new SyncError('旧批次属于不同连接，请重新连接。'); return syncJobSchema.parse(existing) }
        const meta = (await db.syncMetadata.toCollection().first())!
        const created = syncJobSchema.parse({ id: crypto.randomUUID(), schemaVersion: 1, generation: connection.generation, base: meta.baseSnapshotId ? (await db.syncBases.get(meta.baseSnapshotId))?.snapshot : null, local: await this.service.snapshot(), operations: await db.pendingOperations.toArray(), candidate: null, expectedSha: null, createdAt: new Date().toISOString() })
        await db.syncJobs.add(created); return created
      })
      for (let attempt = 0; attempt < 3; attempt++) {
        const lease = await db.syncLeases.get(LEASE_ID)
        const currentConnection = await this.connection()
        if (lease?.holder !== this.holder || currentConnection?.generation !== connection.generation || this.transport !== transport) throw new SyncError('同步连接或租约已变化，请重新检查。')
        await transport.verify(target)
        const file = await transport.get(target)
        if (!file && job.base) throw new SyncError('原有远端文件消失，已停止自动重建。请检查仓库历史。')
        const remote = file ? this.decoded.get(file.sha) ?? await decodeSnapshot(file.text) : null
        if (file && remote) { if (this.decoded.size > 4) this.decoded.clear(); this.decoded.set(file.sha, remote) }
        const recovered = remote && job.candidate && logical(remote) === logical(job.candidate)
        const merged = recovered ? { snapshot: remote, conflicts: [] } : remote ? mergeSnapshots(job.base, job.local, remote) : { snapshot: job.local, conflicts: [] }
        validateLearningSnapshot(merged.snapshot, merged.conflicts.length > 0)
        if (merged.conflicts.length) {
          await this.service.transaction(async () => {
            const current = await this.service.snapshot()
            const combined = mergeSnapshots(job.local, current, merged.snapshot)
            validateLearningSnapshot(combined.snapshot, true)
            await writeWorking(db, combined.snapshot); await replaceConflicts(db, [...merged.conflicts, ...combined.conflicts]); await db.syncJobs.delete(job.id)
          })
          await this.metadata('conflict'); return 'conflict'
        }
        const text = encodeSnapshot(merged.snapshot)
        job = { ...job, candidate: merged.snapshot, expectedSha: file?.sha ?? null }
        await db.syncJobs.put(job)
        let confirmed = file && logical(remote!) === logical(merged.snapshot) ? file : undefined
        if (!confirmed) {
          const active = await this.connection()
          if (active?.generation !== connection.generation || this.transport !== transport || (await db.syncLeases.get(LEASE_ID))?.holder !== this.holder) throw new SyncError('上传前连接已变化，已停止请求。')
          try { confirmed = await transport.put(target, text, file?.sha ?? null) }
          catch (error) {
            if (error instanceof ApiError && error.code === 'sha-conflict' && attempt < 2) { await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt)); continue }
            throw error
          }
        }
        // Commit proof, base advancement, working merge and exact ACK share one transaction.
        await this.service.transaction(async () => {
          const active = await db.connections.get(connection.id); const lease = await db.syncLeases.get(LEASE_ID)
          if (active?.generation !== connection.generation || lease?.holder !== this.holder) throw new SyncError('确认期间连接变化，待同步批次已保留。')
          const current = await this.service.snapshot()
          const remap = (snapshot: DataSnapshot): DataSnapshot => snapshot.settings.id === merged.snapshot.settings.id ? snapshot : { ...snapshot, settings: { ...snapshot.settings, id: merged.snapshot.settings.id, createdAt: merged.snapshot.settings.createdAt } }
          const combined = mergeSnapshots(remap(job.local), remap(current), merged.snapshot)
          validateLearningSnapshot(combined.snapshot, combined.conflicts.length > 0)
          await writeWorking(db, combined.snapshot); await replaceConflicts(db, combined.conflicts)
          await db.syncBases.put({ id: merged.snapshot.id, schemaVersion: 1, snapshot: merged.snapshot, remoteSha: confirmed.sha })
          await db.pendingOperations.bulkDelete(job.operations.map((operation) => operation.id))
          const meta = (await db.syncMetadata.toCollection().first())!
          await db.syncMetadata.put(syncMetadataSchema.parse({ ...meta, baseSnapshotId: merged.snapshot.id, remoteSha: confirmed.sha, lastSyncedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: await db.conflicts.count() ? 'conflict' : await db.pendingOperations.count() ? 'pending' : 'synced', lastErrorCode: undefined }))
          await db.syncJobs.delete(job.id); await db.connections.put({ ...active, retryAt: 0 })
        })
        this.failureCount = 0; return await db.conflicts.count() ? 'conflict' : 'synced'
      }
      throw new ApiError('sha-conflict')
    } catch (error) {
      const known = error instanceof ApiError || error instanceof ProtocolError || error instanceof SyncError
      this.lastError = known ? error.message : '本机事务或数据验证失败，待同步操作已保留。'
      this.failureCount++
      const code = error instanceof ProtocolError ? 'incompatible-schema' : error instanceof ApiError && ['unauthorized', 'forbidden', 'rate-limited', 'sha-conflict'].includes(error.code) ? error.code as SyncMetadata['lastErrorCode'] : 'unknown'
      if (code === 'unauthorized') { transport.clear(); this.transport = undefined }
      const active = await this.connection()
      if (active?.generation === connection.generation) {
        await db.connections.put({ ...active, authorized: code !== 'unauthorized', retryAt: Math.max(error instanceof ApiError ? error.retryAt : 0, Date.now() + Math.min(300_000, 1000 * 2 ** this.failureCount)) })
        await this.metadata('error', code)
      }
      throw new SyncError(this.lastError)
    } finally {
      clearInterval(heartbeat); this.busy = false
      await db.transaction('rw', db.syncLeases, async () => { if ((await db.syncLeases.get(LEASE_ID))?.holder === this.holder) await db.syncLeases.delete(LEASE_ID) })
    }
  }
}

import { z } from 'zod'
import {
  dataSnapshotSchema, pendingOperationSchema, syncConflictSchema, syncMetadataSchema,
  utcDateTimeSchema, uuidSchema, type DataSnapshot,
} from '../../domain'
import { devicePreferencesSchema, ingestedCaptureSchema } from '../../storage/local-models'
import { connectionSchema, syncJobSchema, decisionSchema } from '../../storage/sync-models'
import { canonicalJson } from '../../storage/capture'
import type { LocalVocabularyService } from '../vocabulary/service'
import type { BackupRestoreMode, BackupRestorePort, BackupRestorePreview } from './contracts'

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024
const syncBaseSchema = z.strictObject({ id: uuidSchema, schemaVersion: z.literal(1), remoteSha: z.string().regex(/^[0-9a-f]{40}$/i), snapshot: dataSnapshotSchema })

/** Local disaster-recovery envelope. This is never the remote learning snapshot. */
export const localBackupSchema = z.strictObject({
  format: z.literal('polar-vocab-backup'), backupVersion: z.literal(2), schemaVersion: z.literal(1),
  exportedAt: utcDateTimeSchema, snapshot: dataSnapshotSchema,
  local: z.strictObject({
    syncMetadata: z.array(syncMetadataSchema).max(1),
    syncBases: z.array(syncBaseSchema),
    pendingOperations: z.array(pendingOperationSchema),
    conflicts: z.array(syncConflictSchema),
    devicePreferences: z.array(devicePreferencesSchema),
    connections: z.array(connectionSchema), syncJobs: z.array(syncJobSchema), conflictDecisions: z.array(decisionSchema),
  }),
}).superRefine((backup, context) => {
  for (const [key, records] of Object.entries(backup.local)) {
    const ids = records.map((record) => record.id)
    if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: ['local', key], message: '备份中的记录 ID 不可重复' })
  }
  const baseIds = new Set(backup.local.syncBases.map((base) => base.id))
  backup.local.syncMetadata.forEach((metadata, index) => {
    if (metadata.baseSnapshotId && !baseIds.has(metadata.baseSnapshotId)) context.addIssue({ code: 'custom', path: ['local', 'syncMetadata', index], message: '同步元数据缺少完整基线' })
  })
  backup.local.pendingOperations.forEach((operation, index) => {
    if (operation.baseSnapshotId && !baseIds.has(operation.baseSnapshotId)) context.addIssue({ code: 'custom', path: ['local', 'pendingOperations', index], message: '待同步操作缺少完整基线' })
  })
  const devices = backup.local.devicePreferences.map((record) => record.deviceId)
  if (new Set(devices).size !== devices.length) context.addIssue({ code: 'custom', path: ['local', 'devicePreferences'], message: '同设备不能存在多个偏好设置' })
})

export type LocalBackup = z.infer<typeof localBackupSchema>
export interface BackupCounts { vocabularies: number; cards: number; reviewEvents: number; tombstones: number; pendingOperations: number }
export interface LocalBackupPreview extends BackupRestorePreview {
  backupVersion: 2
  exportedAt: string
  counts: BackupCounts
  preRestoreBackup: Blob
}
export interface ClearLocalPreview { id: string; counts: BackupCounts; preClearBackup: Blob }

export class BackupError extends Error {
  readonly code: 'format' | 'version' | 'invalid-data' | 'stale-preview' | 'deletion-history' | 'review-history' | 'immutable-id' | 'unsupported-mode'
  constructor(code: BackupError['code'], message: string) {
    super(message); this.name = 'BackupError'; this.code = code
  }
}

async function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new BackupError('format', '文件读取失败，请重新选择。'))
    reader.readAsText(blob, 'UTF-8')
  })
}

function jsonBlob(value: LocalBackup): Blob {
  return new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' })
}
function counts(backup: LocalBackup): BackupCounts {
  return { vocabularies: backup.snapshot.vocabularies.length, cards: backup.snapshot.cards.length, reviewEvents: backup.snapshot.reviewEvents.length, tombstones: backup.snapshot.tombstones.length, pendingOperations: backup.local.pendingOperations.length }
}
function fingerprint(backup: LocalBackup): string {
  const { id: _snapshotId, exportedAt: _snapshotTime, ...snapshot } = backup.snapshot
  // IDs/timestamps allocated for the export itself do not represent working-state changes.
  void _snapshotId; void _snapshotTime
  return canonicalJson({ snapshot, local: backup.local })
}

function checkReplacement(current: LocalBackup, incoming: LocalBackup): void {
  for (const collection of ['reviewEvents', 'reviewResolutions'] as const) {
    const incomingIds = new Set(incoming.snapshot[collection].map((record) => record.id))
    if (current.snapshot[collection].some((record) => !incomingIds.has(record.id))) {
      throw new BackupError('review-history', '备份缺少本机已有复习历史，恢复已阻止。请保留当前完整备份，不要用旧备份回退已完成的学习。')
    }
  }
  const tombstones = new Map(incoming.snapshot.tombstones.map((record) => [record.id, record]))
  for (const tombstone of current.snapshot.tombstones) {
    if (!tombstones.has(tombstone.id) || canonicalJson(tombstones.get(tombstone.id)) !== canonicalJson(tombstone)) {
      throw new BackupError('deletion-history', '备份缺少或改变了本机已有删除标记。为防止旧词复活，本次恢复已阻止；请使用包含删除证据的备份。')
    }
  }
  const collections = ['captures', 'reviewEvents', 'reviewResolutions', 'tombstones'] as const
  for (const key of collections) {
    const existing = new Map(current.snapshot[key].map((record) => [record.id, canonicalJson(record)]))
    for (const record of incoming.snapshot[key]) {
      if (existing.has(record.id) && existing.get(record.id) !== canonicalJson(record)) throw new BackupError('immutable-id', '同一事件 ID 的内容不一致，不能通过恢复覆盖不可变历史。')
    }
  }
  const existingEntries = new Map(current.snapshot.vocabularies.map((record) => [record.id, record]))
  for (const entry of incoming.snapshot.vocabularies) {
    const existing = existingEntries.get(entry.id)
    if (existing && (existing.lang !== entry.lang || existing.origin !== entry.origin || existing.createdAt !== entry.createdAt)) throw new BackupError('immutable-id', '同一词条 ID 的语言、来源身份或创建时间发生变化，恢复已阻止。')
  }
  const existingCards = new Map(current.snapshot.cards.map((record) => [record.id, record]))
  for (const card of incoming.snapshot.cards) {
    const existing = existingCards.get(card.id)
    if (existing && (existing.vocabularyId !== card.vocabularyId || existing.template !== card.template || existing.createdAt !== card.createdAt)) throw new BackupError('immutable-id', '同一卡片 ID 的词条目标、模板或创建时间发生变化，恢复已阻止。')
  }
  const existingOperations = new Map(current.local.pendingOperations.map((operation) => [operation.id, canonicalJson(operation)]))
  for (const operation of incoming.local.pendingOperations) {
    if (existingOperations.has(operation.id) && existingOperations.get(operation.id) !== canonicalJson(operation)) throw new BackupError('immutable-id', '同一待同步操作 ID 的内容不一致，恢复已阻止。')
  }
}

/** Preview is read-only; destructive writes require a sealed preview and unchanged working state. */
export class LocalBackupService implements BackupRestorePort {
  private restorePlans = new Map<string, { incoming: LocalBackup; expected: string; preRestoreBackup: Blob }>()
  private clearPlans = new Map<string, { expected: string; preClearBackup: Blob }>()
  private readonly service: LocalVocabularyService
  constructor(service: LocalVocabularyService) { this.service = service }

  private async readCurrent(): Promise<LocalBackup> {
    const db = this.service.db
    const settings = await db.settings.toArray()
    if (settings.length !== 1) throw new BackupError('invalid-data', '设置结构不完整，不能创建有效备份。')
    const metadata = await db.syncMetadata.toArray()
    if (metadata.length !== 1) throw new BackupError('invalid-data', '本机元数据结构不完整，不能创建有效备份。')
    return localBackupSchema.parse({
      format: 'polar-vocab-backup', backupVersion: 2, schemaVersion: 1, exportedAt: new Date().toISOString(),
      snapshot: {
        id: crypto.randomUUID(), schemaVersion: 1, exportedAt: new Date().toISOString(), settings: settings[0],
        vocabularies: await db.vocabularies.toArray(), cards: await db.cards.toArray(), reviewEvents: await db.reviewEvents.toArray(),
        captures: await db.captures.toArray(), tombstones: await db.tombstones.toArray(), reviewResolutions: await db.reviewResolutions.toArray(),
        ingestedCaptureIds: (await db.ingestedCaptures.toArray()).map((record) => ingestedCaptureSchema.parse(record).id),
      },
      local: {
        syncMetadata: metadata, syncBases: await db.syncBases.toArray(),
        pendingOperations: await db.pendingOperations.toArray(), conflicts: await db.conflicts.toArray(), devicePreferences: await db.devicePreferences.toArray(),
        connections: await db.connections.toArray(), syncJobs: await db.syncJobs.toArray(), conflictDecisions: await db.conflictDecisions.toArray(),
      },
    })
  }

  private async current(): Promise<LocalBackup> {
    await this.service.initialize()
    return this.service.db.transaction('r', this.service.db.tables, () => this.readCurrent())
  }

  async exportBackup(): Promise<Blob> { return jsonBlob(await this.current()) }

  async preview(file: File): Promise<LocalBackupPreview> {
    if (!file.name.toLowerCase().endsWith('.json') || file.size === 0 || file.size > MAX_BACKUP_BYTES) throw new BackupError('format', '请选择不超过 20 MiB 的 JSON 完整备份文件。')
    let raw: unknown
    try { raw = JSON.parse((await blobText(file)).replace(/^\uFEFF/, '')) } catch { throw new BackupError('format', '文件不是合法 JSON，原数据未修改。') }
    if (raw && typeof raw === 'object' && ('schemaVersion' in raw && raw.schemaVersion !== 1 || 'backupVersion' in raw && raw.backupVersion !== 1 && raw.backupVersion !== 2)) throw new BackupError('version', '备份或数据版本不兼容，已拒绝写入。')
    // Explicit v1 -> v2 wrapper migration: shared records are never rewritten.
    if (raw && typeof raw === 'object' && 'backupVersion' in raw && raw.backupVersion === 1 && 'local' in raw && raw.local && typeof raw.local === 'object') {
      if (['connections', 'syncJobs', 'conflictDecisions'].some((key) => key in (raw as { local: object }).local)) throw new BackupError('invalid-data', '旧格式包含新版本机字段，请保留原文件并核查版本。')
      raw = { ...raw, backupVersion: 2, local: { ...raw.local, connections: [], syncJobs: [], conflictDecisions: [] } }
    }
    const parsed = localBackupSchema.safeParse(raw)
    if (!parsed.success) throw new BackupError('invalid-data', '备份字段、事件引用或删除证据未通过校验，原数据未修改。')
    const incoming = parsed.data
    try {
      const { validateLearningSnapshot } = await import('../review/integrity')
      validateLearningSnapshot(incoming.snapshot, incoming.local.conflicts.length > 0)
    } catch (error) { throw new BackupError('invalid-data', error instanceof Error ? error.message : '备份中的学习状态不兼容。') }
    const current = await this.current()
    checkReplacement(current, incoming)
    const restoreId = crypto.randomUUID()
    const preRestoreBackup = jsonBlob(current)
    // Keep at most one plan; no mutable UI object is trusted when committing.
    this.restorePlans.clear()
    this.restorePlans.set(restoreId, { incoming, expected: fingerprint(current), preRestoreBackup })
    return { restoreId, mode: 'restore-backup', format: 'json', snapshot: structuredClone(incoming.snapshot), backupVersion: 2, exportedAt: incoming.exportedAt, counts: counts(incoming), preRestoreBackup }
  }

  async restore(preview: BackupRestorePreview, mode: BackupRestoreMode): Promise<{ restoredSnapshotId: string; preRestoreBackup: Blob }> {
    if (mode !== 'replace-local') throw new BackupError('unsupported-mode', '本阶段仅支持确认后的本机替换恢复，不支持合并恢复或多工作区。')
    const plan = this.restorePlans.get(preview.restoreId)
    if (!plan) throw new BackupError('stale-preview', '恢复预览已失效，请重新选择并检查文件。')
    const db = this.service.db
    await this.service.initialize()
    const { validateLearningSnapshot } = await import('../review/integrity')
    await db.transaction('rw', db.tables, async () => {
      const current = await this.readCurrent()
      if (fingerprint(current) !== plan.expected) throw new BackupError('stale-preview', '预览后本机数据已变化，请重新预览，避免覆盖刚保存的数据。')
      checkReplacement(current, plan.incoming)
      const { snapshot, local } = plan.incoming
      const deviceId = current.local.syncMetadata[0].deviceId
      const metadata = syncMetadataSchema.parse({ ...current.local.syncMetadata[0], status: 'unconfigured', baseSnapshotId: null, remoteSha: null, lastSyncedAt: null, updatedAt: new Date().toISOString(), lastErrorCode: undefined })
      for (const table of db.tables) await table.clear()
      await db.vocabularies.bulkAdd(snapshot.vocabularies)
      await db.cards.bulkAdd(snapshot.cards)
      await db.reviewEvents.bulkAdd(snapshot.reviewEvents)
      await db.captures.bulkAdd(snapshot.captures)
      await db.tombstones.bulkAdd(snapshot.tombstones)
      await db.reviewResolutions.bulkAdd(snapshot.reviewResolutions)
      await db.settings.add(snapshot.settings)
      await db.ingestedCaptures.bulkAdd(snapshot.ingestedCaptureIds.map((id) => ({ id, schemaVersion: 1 as const })))
      await db.syncMetadata.add(metadata)
      await db.syncBases.bulkAdd(local.syncBases)
      await db.pendingOperations.bulkAdd(local.pendingOperations)
      await db.conflicts.bulkAdd(local.conflicts)
      await db.conflictDecisions.bulkAdd(local.conflictDecisions)
      // Incoming attempts remain in the backup file only; connection and SHA must be reverified.
      const language = local.devicePreferences[0]?.defaultLanguage ?? 'en'
      await db.devicePreferences.add(devicePreferencesSchema.parse({ id: deviceId, deviceId, schemaVersion: 1, defaultLanguage: language, updatedAt: new Date().toISOString() }))
      // Verify the complete persisted shape before allowing this transaction to commit.
      validateLearningSnapshot((await this.readCurrent()).snapshot, local.conflicts.length > 0)
    })
    window.dispatchEvent(new Event('polar-vocab-storage-reset'))
    this.restorePlans.delete(preview.restoreId)
    this.service.invalidateInitialization()
    await this.service.initialize()
    return { restoredSnapshotId: plan.incoming.snapshot.id, preRestoreBackup: plan.preRestoreBackup }
  }

  async prepareClear(): Promise<ClearLocalPreview> {
    const current = await this.current()
    const id = crypto.randomUUID()
    const preClearBackup = jsonBlob(current)
    this.clearPlans.clear()
    this.clearPlans.set(id, { expected: fingerprint(current), preClearBackup })
    return { id, counts: counts(current), preClearBackup }
  }

  async clearLocal(preview: ClearLocalPreview): Promise<{ preClearBackup: Blob }> {
    const plan = this.clearPlans.get(preview.id)
    if (!plan) throw new BackupError('stale-preview', '清除确认已失效，请重新生成备份和确认。')
    const db = this.service.db
    let resetAttempted = false
    try {
      await db.transaction('rw', db.tables, async () => {
        if (fingerprint(await this.readCurrent()) !== plan.expected) throw new BackupError('stale-preview', '确认期间本机数据已变化，未清除。请重新备份并确认。')
        for (const table of db.tables) await table.clear()
        // Reset the empty profile inside the same transaction: failures roll back the clear too.
        resetAttempted = true
        this.service.invalidateInitialization()
        await this.service.initialize()
        await this.readCurrent()
      })
    } catch (error) {
      if (resetAttempted) {
        // The old profile is restored by rollback. Revalidate outside liveQuery so its
        // next read cannot attempt a write transaction. Preserve the original failure.
        this.service.invalidateInitialization()
        await this.service.initialize().catch(() => undefined)
      }
      throw error
    }
    window.dispatchEvent(new Event('polar-vocab-storage-reset'))
    this.clearPlans.delete(preview.id)
    return { preClearBackup: plan.preClearBackup }
  }
}

/** Useful for displaying a counts-only preview without leaking local metadata. */
export function snapshotCounts(snapshot: DataSnapshot): Omit<BackupCounts, 'pendingOperations'> {
  return { vocabularies: snapshot.vocabularies.length, cards: snapshot.cards.length, reviewEvents: snapshot.reviewEvents.length, tombstones: snapshot.tombstones.length }
}

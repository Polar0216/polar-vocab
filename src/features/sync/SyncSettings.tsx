import { useEffect, useMemo, useState } from 'react'
import { liveQuery } from 'dexie'
import { useVocabulary } from '../../app/vocabulary-context'
import { Dialog } from '../../components/Dialog'
import { Feedback } from '../../components/Feedback'
import { downloadBlob, datedFilename } from '../../components/download'
import { LocalBackupService } from '../import-export/backup-service'
import { syncEngine, type ConnectionPreview } from './engine'
import { resolveConflict } from './resolutions'
import { MAX_REMOTE_BYTES, WARN_REMOTE_BYTES, utf8Size } from '../../integrations/github/client'
import type { Connection } from '../../storage/sync-models'
import type { SyncConflict, SyncMetadata, DataSnapshot } from '../../domain'

const statusLabel = { unconfigured: '未连接', idle: '连接正常', pending: '存在待同步操作', syncing: '正在同步', synced: '已同步', conflict: '存在未解决冲突', error: '同步失败' }
export function SyncSettings() {
  const { service, ready } = useVocabulary()
  const engine = useMemo(() => syncEngine(service), [service])
  const [owner, setOwner] = useState(''), [repo, setRepo] = useState(''), [branch, setBranch] = useState(''), [token, setToken] = useState('')
  const [learningSettings, setLearningSettings] = useState<'remote' | 'local'>('remote')
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState(''), [online, setOnline] = useState(navigator.onLine)
  const [preview, setPreview] = useState<ConnectionPreview | null>(null), [saved, setSaved] = useState(false), [ack, setAck] = useState(false)
  const [state, setState] = useState<{ connection?: Connection; metadata?: SyncMetadata; pending: number; conflicts: SyncConflict[]; cloud?: DataSnapshot; active: boolean; bytes: number }>({ pending: 0, conflicts: [], active: false, bytes: 0 })
  const [decision, setDecision] = useState<{ conflict: SyncConflict; choice: Parameters<typeof resolveConflict>[2]; selectedId?: string } | null>(null)
  useEffect(() => {
    if (!ready) return
    const db = service.db
    const subscription = liveQuery(async () => {
      const metadata = await db.syncMetadata.toCollection().first()
      const bytes = utf8Size(JSON.stringify(await service.snapshot())) + 160
      return { bytes, connection: await db.connections.toCollection().first(), metadata, pending: await db.pendingOperations.count(), conflicts: await db.conflicts.toArray(), active: await db.syncLeases.count() > 0, cloud: metadata?.baseSnapshotId ? (await db.syncBases.get(metadata.baseSnapshotId))?.snapshot : undefined }
    }).subscribe({ next: setState, error: () => setFeedback('本机同步状态读取失败，请保留备份后重试。') })
    const updateOnline = () => setOnline(navigator.onLine)
    window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline)
    return () => { subscription.unsubscribe(); window.removeEventListener('online', updateOnline); window.removeEventListener('offline', updateOnline) }
  }, [service, ready])
  async function run(work: () => Promise<void>) { setBusy(true); setFeedback(''); try { await work() } catch (error) { setFeedback(error instanceof Error && ['SyncError', 'ApiError', 'ProtocolError'].includes(error.name) ? error.message : '操作未确认成功，请保留本机数据并重新检查。') } finally { setBusy(false) } }
  async function backup() { downloadBlob(await new LocalBackupService(service).exportBackup(), datedFilename('polar-vocab-before-sync', 'json')); setSaved(true) }
  const label = !state.connection ? '未连接' : !online ? '当前离线 · 本机修改保留' : state.active ? '正在同步' : state.metadata?.lastErrorCode === 'unauthorized' ? 'Token 失效' : state.metadata?.lastErrorCode === 'incompatible-schema' ? '远端协议不兼容' : state.conflicts.length ? '存在未解决冲突' : !engine.authorized() ? '需要重新授权' : state.metadata?.status === 'error' ? '同步失败' : state.pending ? '存在待同步操作' : statusLabel[state.metadata?.status ?? 'idle']
  return <section className="settings-card sync-settings">
    <div className="settings-heading"><div><h2>GitHub 私有同步</h2><p>本机先保存，再与指定私有仓库合并。公开网页不保存你的凭证。</p></div></div>
    <p role="status" className="sync-status"><strong>{label}</strong></p>
    <dl className="storage-stats"><div><dt>当前仓库</dt><dd>{state.connection ? `${state.connection.owner}/${state.connection.repository} · ${state.connection.branch}` : '未配置'}</dd></div><div><dt>最近成功同步</dt><dd>{state.metadata?.lastSyncedAt ? new Date(state.metadata.lastSyncedAt).toLocaleString('zh-CN') : '尚无'}</dd></div><div><dt>待同步操作</dt><dd>{state.pending} 项</dd></div><div><dt>未解决冲突</dt><dd>{state.conflicts.length} 项</dd></div></dl>
    {state.cloud && <p className="form-help">最近确认的云端快照：{state.cloud.vocabularies.length} 词条 / {state.cloud.cards.length} 卡片 / {state.cloud.reviewEvents.length} 评分；这不是远端实时状态。</p>}
    {state.bytes >= WARN_REMOTE_BYTES && <Feedback message={`本机云端格式估算约 ${state.bytes.toLocaleString()} 字节，接近同步容量上限；请保留完整备份。实际提交按完整规范快照精确检查。`} error />}
    {feedback && <Feedback message={feedback} error />}
    <div className="backup-actions"><button className="button button-primary" disabled={busy || !engine.authorized() || !online} onClick={() => void run(async () => { await engine.synchronize() })}>立即同步</button><button className="button button-secondary" disabled={!ready || busy} onClick={() => void run(backup)}>同步前导出完整备份</button>{state.connection && <button className="button button-secondary" disabled={busy} onClick={() => void run(async () => { await engine.disconnect(); setToken('') })}>断开连接，保留本机数据</button>}</div>
    {state.connection && <label className="confirmation-check"><input type="checkbox" checked={state.connection.auto} disabled={busy} onChange={(event) => void run(() => engine.setAuto(event.target.checked))} />自动同步（批量、节流；关闭网页不保证上传）</label>}
    <details open={!state.connection || !engine.authorized()}><summary>连接或重新授权</summary><form onSubmit={(event) => { event.preventDefault(); void run(async () => { const result = await engine.test({ owner: owner || state.connection?.owner || '', repository: repo || state.connection?.repository || '', branch: branch || state.connection?.branch || '' }, token); setToken(''); setPreview(result); setSaved(false); setAck(false) }) }}>
      <div className="settings-form"><label className="field"><span>仓库所有者</span><input aria-label="仓库所有者" value={owner} placeholder={state.connection?.owner ?? 'GitHub 用户名'} onChange={(event) => setOwner(event.target.value)} autoComplete="off" /></label><label className="field"><span>私有仓库名称</span><input aria-label="私有仓库名称" value={repo} placeholder={state.connection?.repository ?? 'polar-vocab-data'} onChange={(event) => setRepo(event.target.value)} autoComplete="off" /></label><label className="field"><span>目标分支（可选）</span><input aria-label="目标分支" value={branch} placeholder={state.connection?.branch ?? '默认分支'} onChange={(event) => setBranch(event.target.value)} autoComplete="off" /></label><label className="field"><span>Fine-grained PAT</span><input type="password" aria-label="Fine-grained PAT" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" spellCheck={false} /></label></div><p className="form-help">仅授权这个私有仓库的 Contents: Read and write，设置有效期。凭证只在内存中，刷新或关闭后重新输入。请勿发送到聊天或公开文件。只读测试不能证明写权限和分支规则允许提交。</p><button className="button button-secondary" disabled={!ready || busy || !token.trim() || !online}>测试连接（只读）</button>
    </form></details>
    <p className="settings-footnote">同步容量上限 {MAX_REMOTE_BYTES.toLocaleString()} 字节，接近上限会提示，超限保留完整本机数据并阻止上传。授权后运行的网页和浏览器扩展仍可能读取内存，私有仓库不是端到端加密。</p>
    {state.conflicts.length > 0 && <div className="sync-conflicts"><h3>同步冲突</h3><p className="form-help">原始副本和事件都保留。选择后会写入审计记录，再检查最新远端 SHA；身份损坏不能直接覆盖。</p>{state.conflicts.map((conflict) => <article className="sync-conflict" key={conflict.id}>
      <h4>{conflict.local && 'lemma' in conflict.local ? conflict.local.lemma : conflict.entityId}</h4><p>{conflict.kind} · {conflict.fields.join('、')}</p>
      <div className="sync-diff">{(['base', 'local', 'remote'] as const).map((side) => <details key={side}><summary>{side === 'base' ? '共同基线' : side === 'local' ? '本机副本' : '远端副本'}</summary><pre>{JSON.stringify(conflict[side], null, 2)}</pre></details>)}</div>
      {conflict.kind === 'review-branch' ? <ReviewChoices service={service} cardId={conflict.entityId} onSelect={(selectedId) => { setDecision({ conflict, choice: 'review', selectedId }); setAck(false) }} /> : conflict.fields.includes('duplicate-template') ? <div className="backup-actions">{[conflict.local, conflict.remote].map((card) => card && <button className="button button-secondary" key={card.id} disabled={busy} onClick={() => { setDecision({ conflict, choice: 'card', selectedId: card.id }); setAck(false) }}>保留卡片 {card.id.slice(0, 8)}，另一张保留历史并删除</button>)}</div> : conflict.kind === 'delete-vs-edit' ? <button className="button button-secondary" disabled={busy} onClick={() => { setDecision({ conflict, choice: 'keep-deleted' }); setAck(false) }}>保留删除及编辑审计副本</button> : conflict.kind !== 'immutable-id' && !conflict.fields.includes('missing-record') ? <div className="backup-actions">{(['local', 'remote'] as const).map((choice) => <button className="button button-secondary" disabled={busy} key={choice} onClick={() => { setDecision({ conflict, choice }); setAck(false) }}>{choice === 'local' ? '采用本机版本' : '采用远端版本'}</button>)}</div> : <p>请先导出备份，核查身份及 GitHub 历史，当前阻止上传。</p>}
    </article>)}</div>}
    {preview && <Dialog title="确认首次连接与数据合并" onClose={() => { if (!busy) { engine.cancelPreview(); setPreview(null) } }}><p>目标：{preview.target.owner}/{preview.target.repository} · {preview.target.branch}</p><p>本机 {preview.local.vocabularies.length} 词条 / {preview.local.reviewEvents.length} 评分；云端 {preview.remote?.vocabularies.length ?? 0} 词条 / {preview.remote?.reviewEvents.length ?? 0} 评分。情况 {preview.case}，文件 {preview.bytes.toLocaleString()} 字节，预检冲突 {preview.conflicts} 项。</p><p className="form-help">确认后重新读取最新版本；远端存在时采用其共享设置身份，再合并本机记录。冲突会保留并停止上传。没有文件时才初始化，仓库与分支已只读验证。</p>{preview.remote && <div><p>共享学习设置：本机新卡 EN {preview.local.settings.dailyNew.en} / DE {preview.local.settings.dailyNew.de}，保持率 {preview.local.settings.desiredRetention}；云端 EN {preview.remote.settings.dailyNew.en} / DE {preview.remote.settings.dailyNew.de}，保持率 {preview.remote.settings.desiredRetention}。</p><label className="field"><span>首次连接的共享设置</span><select value={learningSettings} onChange={(event) => setLearningSettings(event.target.value as 'remote' | 'local')}><option value="remote">采用已验证云端设置</option><option value="local">明确保留本机设置，提交新的共同修订</option></select></label></div>}{preview.bytes >= WARN_REMOTE_BYTES && <Feedback message="快照接近容量上限，请保存完整备份并准备未来协议迁移。" error />}<button className="button button-secondary" disabled={busy} onClick={() => void run(backup)}>下载连接前完整备份</button><label className="confirmation-check"><input type="checkbox" disabled={!saved || busy} checked={ack} onChange={(event) => setAck(event.target.checked)} />我已保存备份，并确认对上述私有目标进行初始化或合并。</label><button className="button button-primary" disabled={busy || !saved || !ack} onClick={() => void run(async () => { const confirmed = preview; setPreview(null); await engine.confirm(confirmed, learningSettings) })}>确认连接并同步</button></Dialog>}
    {decision && <Dialog title="确认冲突决议" onClose={() => { if (!busy) setDecision(null) }}><p>将采用所选合法版本，记录审计信息。评分原始事件不删除；语义重复卡片的另一张将软删除并保留历史。决议后仍需同步确认。</p><label className="confirmation-check"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />我已检查差异并确认此决议。</label><button className="button button-primary" disabled={busy || !ack} onClick={() => void run(async () => { await resolveConflict(service, decision.conflict.id, decision.choice, decision.selectedId); setDecision(null) })}>保存决议</button></Dialog>}
  </section>
}
function ReviewChoices({ service, cardId, onSelect }: { service: ReturnType<typeof useVocabulary>['service']; cardId: string; onSelect: (id: string) => void }) {
  const [snapshot, setSnapshot] = useState<DataSnapshot>()
  useEffect(() => { let active = true; void service.snapshot().then((data) => { if (active) setSnapshot(data) }); return () => { active = false } }, [service, cardId])
  const ignored = new Set(snapshot?.reviewResolutions.flatMap((r) => r.ignoredEventIds))
  const events = snapshot?.reviewEvents.filter((event) => event.cardId === cardId && !ignored.has(event.id)) ?? []
  const roots = events.filter((event) => events.filter((other) => other.parentStateId === event.parentStateId).length > 1)
  return <div>{roots.map((event) => <div className="sync-event" key={event.id}><p>{event.rating} · {new Date(event.reviewedAt).toLocaleString('zh-CN')} · 设备 {event.deviceId}</p><details><summary>原始评分事件</summary><pre>{JSON.stringify(event, null, 2)}</pre></details><button className="button button-secondary" onClick={() => onSelect(event.id)}>采用 {event.rating} 分支</button></div>)}</div>
}

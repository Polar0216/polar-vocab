import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { canonicalJson, captureEventSchema, captureBatchSchema, encodeBatch, batchPath, payloadRequiresProtocol2, type CaptureEvent, type CaptureBatch } from '../../../packages/shared'
import { defaultSettings, desktopSettingsSchema, type DesktopSettings, type QueueItem, type QueueState } from './contracts'
import { CREATE_QUEUE_SQL, inspectQueueDatabase, inspectOpenQueue, QueueDataError, QUEUE_VERSION } from './queue-storage'

interface QueueRow { id: string; event: string; state: QueueState; batch_id: string | null; error_code: string | null }
export interface FrozenBatch { batch: CaptureBatch; target: string; sha: string | null }

/** This SQLite file contains captures/outbox only; never cards, FSRS or tokens. */
export class CaptureQueue {
  private readonly db: DatabaseSync
  readonly deviceId: string
  constructor(path: string) {
    const existing = inspectQueueDatabase(path)
    if (existing?.version === 1) throw new QueueDataError('legacy-version', '旧版队列须先备份迁移，未直接改写。')
    this.db = new DatabaseSync(path)
    try {
      const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version)
      if (![0, QUEUE_VERSION].includes(version)) throw new QueueDataError('future-version', '本地采集队列版本不兼容，未改写。')
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;')
      if (version === 0) this.db.exec(CREATE_QUEUE_SQL)
    } catch (error) { this.db.close(); throw error }
    this.deviceId = this.meta('deviceId') ?? randomUUID()
    this.db.prepare('INSERT OR IGNORE INTO metadata(key,value) VALUES(?,?)').run('deviceId', this.deviceId)
    this.transaction(() => {
      this.db.prepare("UPDATE batches SET state='failed',error_code='interrupted' WHERE state='uploading'").run()
      this.db.prepare("UPDATE captures SET state='failed',error_code='interrupted' WHERE state='uploading'").run()
    })
    // Validate before the recovery UPDATEs on future opens; do not replace a bad queue.
    inspectOpenQueue(this.db)
  }
  private meta(key: string): string | undefined { return this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value as string | undefined }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = work(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  settings(): DesktopSettings { const value = this.meta('settings'); return value ? desktopSettingsSchema.parse(JSON.parse(value)) : { ...defaultSettings } }
  setSettings(value: DesktopSettings): void { this.db.prepare('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)').run('settings', canonicalJson(desktopSettingsSchema.parse(value))) }
  connection(): { owner: string; repository: string; branch: string } | undefined { const value = this.meta('target'); return value ? JSON.parse(value) : undefined }
  setConnection(value: { owner: string; repository: string; branch: string } | undefined): void {
    if (value) this.db.prepare('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)').run('target', canonicalJson(value))
    else this.db.prepare('DELETE FROM metadata WHERE key=?').run('target')
  }
  save(event: CaptureEvent): string {
    const validated = captureEventSchema.parse(event), text = canonicalJson(validated)
    if (validated.deviceId !== this.deviceId || validated.origin !== 'windows') throw new Error('采集事件不属于本机Windows队列，未保存。')
    if (new TextEncoder().encode(text).length > 150_000) throw new Error('该采集内容过大，请缩短释义或原句后再保存。')
    return this.transaction(() => {
      const old = this.db.prepare('SELECT event FROM captures WHERE id=?').get(validated.id)
      if (old) { if (String(old.event) !== text) throw new Error('同一采集ID已有不同内容，未覆盖原记录。'); return validated.id }
      this.db.prepare("INSERT INTO captures(id,event,captured_at,state) VALUES(?,?,?,'pending')").run(validated.id, text, validated.capturedAt)
      return validated.id
    })
  }
  find(id: string): CaptureEvent | undefined { const row = this.db.prepare('SELECT event FROM captures WHERE id=?').get(id); return row ? captureEventSchema.parse(JSON.parse(String(row.event))) : undefined }
  counts(): Record<QueueState, number> {
    const result: Record<QueueState, number> = { pending: 0, uploading: 0, acknowledged: 0, failed: 0, attention: 0 }
    for (const row of this.db.prepare('SELECT state,COUNT(*) AS count FROM captures GROUP BY state').all()) {
      if (!(String(row.state) in result)) throw new Error('队列状态不兼容，未清除记录。')
      result[row.state as QueueState] = Number(row.count)
    }
    return result
  }
  list(search: string, state: QueueState | 'all', offset = 0): { items: QueueItem[]; total: number } {
    const pattern = '%' + search.replace(/[\\%_]/g, '\\$&') + '%'
    const where = "event LIKE ? ESCAPE '\\' AND (?='all' OR state=?)"
    const rows = this.db.prepare(`SELECT * FROM captures WHERE ${where} ORDER BY captured_at DESC,id LIMIT 100 OFFSET ?`).all(pattern, state, state, offset) as unknown as QueueRow[]
    const total = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM captures WHERE ${where}`).get(pattern, state, state)!.count)
    return { total, items: rows.map((row) => ({ event: captureEventSchema.parse(JSON.parse(row.event)), state: row.state, batchId: row.batch_id, errorCode: row.error_code })) }
  }
  freeze(target: string): FrozenBatch | null {
    return this.transaction(() => {
      const old = this.db.prepare("SELECT * FROM batches WHERE state!='acknowledged' ORDER BY rowid LIMIT 1").get()
      if (old) {
        if (old.target !== target) throw new Error('原上传批次属于另一仓库或分支，请重新连接原目标或导出队列；未改投目标。')
        return { batch: captureBatchSchema.parse(JSON.parse(String(old.body))), target, sha: old.sha as string | null }
      }
      const rows = this.db.prepare("SELECT * FROM captures WHERE state='pending' AND batch_id IS NULL ORDER BY captured_at,id LIMIT 50").all() as unknown as QueueRow[]
      if (!rows.length) return null
      const first = captureEventSchema.parse(JSON.parse(rows[0].event)), events: CaptureEvent[] = []
      const id = randomUUID(), month = first.capturedAt.slice(0, 7)
      for (const row of rows) {
        const event = captureEventSchema.parse(JSON.parse(row.event))
        if (event.capturedAt.slice(0, 7) !== month) continue
        try { encodeBatch({ format: 'polar-vocab-capture-batch', protocolVersion: [...events, event].some(item => payloadRequiresProtocol2(item.payload)) ? 2 : 1, schemaVersion: 1, id, deviceId: this.deviceId, month, events: [...events, event] }) }
        catch { if (events.length) break; throw new Error('单条记录超出采集批次预算，请导出并人工核查。') }
        events.push(event)
      }
      const batch = captureBatchSchema.parse({ format: 'polar-vocab-capture-batch', protocolVersion: events.some(item => payloadRequiresProtocol2(item.payload)) ? 2 : 1, schemaVersion: 1, id, deviceId: this.deviceId, month, events })
      const body = encodeBatch(batch)
      this.db.prepare("INSERT INTO batches(id,body,target,state) VALUES(?,?,?,'prepared')").run(id, body, target)
      for (const event of events) this.db.prepare("UPDATE captures SET batch_id=?,state='uploading' WHERE id=? AND batch_id IS NULL").run(id, event.id)
      return { batch, target, sha: null }
    })
  }
  uploading(batch: CaptureBatch): void {
    this.transaction(() => { this.db.prepare("UPDATE batches SET state='uploading',error_code=NULL WHERE id=?").run(batch.id); this.db.prepare("UPDATE captures SET state='uploading',error_code=NULL WHERE batch_id=?").run(batch.id) })
  }
  acknowledge(batch: CaptureBatch, sha: string): void {
    if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error('上传回执不合法，队列保留。')
    this.transaction(() => {
      const row = this.db.prepare('SELECT body FROM batches WHERE id=?').get(batch.id)
      if (!row || String(row.body) !== encodeBatch(batch)) throw new Error('上传批次不匹配，未确认队列。')
      const captures = this.db.prepare('SELECT * FROM captures WHERE batch_id=?').all(batch.id) as unknown as QueueRow[]
      if (captures.length !== batch.events.length || batch.events.some((event) => !captures.some((capture) => capture.id === event.id && capture.event === canonicalJson(event)))) throw new Error('批次事件不匹配，未确认队列。')
      this.db.prepare("UPDATE batches SET state='acknowledged',sha=?,error_code=NULL WHERE id=?").run(sha, batch.id)
      this.db.prepare("UPDATE captures SET state='acknowledged',error_code=NULL WHERE batch_id=?").run(batch.id)
    })
  }
  fail(batch: CaptureBatch, code: string, attention = false): void {
    const state = attention ? 'attention' : 'failed'
    this.transaction(() => { this.db.prepare('UPDATE batches SET state=?,error_code=? WHERE id=?').run(state, code, batch.id); this.db.prepare('UPDATE captures SET state=?,error_code=? WHERE batch_id=?').run(state, code, batch.id) })
  }
  retry(): void { this.transaction(() => { this.db.prepare("UPDATE captures SET state=CASE WHEN batch_id IS NULL THEN 'pending' ELSE 'failed' END,error_code=NULL WHERE state='failed'").run() }) }
  export(): string {
    return JSON.stringify({ format: 'polar-vocab-desktop-queue', queueVersion: QUEUE_VERSION, exportedAt: new Date().toISOString(), deviceId: this.deviceId,
      records: this.db.prepare('SELECT event,state,batch_id,error_code FROM captures ORDER BY captured_at,id').all().map((row) => ({ event: JSON.parse(String(row.event)), state: row.state, batchId: row.batch_id, errorCode: row.error_code })),
      batches: this.db.prepare('SELECT body,target,state,sha FROM batches ORDER BY rowid').all().map((row) => ({ batch: JSON.parse(String(row.body)), path: batchPath(JSON.parse(String(row.body))), target: row.target, state: row.state, sha: row.sha })),
    }, null, 2)
  }
  close(): void { this.db.close() }
}

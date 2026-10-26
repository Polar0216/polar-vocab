import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { canonicalJson, captureBatchSchema, captureEventSchema, uuidSchema } from '../../../packages/shared'
import { desktopSettingsSchema } from './contracts'

export const QUEUE_VERSION = 2
export const CREATE_QUEUE_SQL = `CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY,body TEXT NOT NULL,target TEXT NOT NULL,state TEXT NOT NULL,sha TEXT,error_code TEXT);
  CREATE TABLE IF NOT EXISTS captures (id TEXT PRIMARY KEY,event TEXT NOT NULL,captured_at TEXT NOT NULL,state TEXT NOT NULL,batch_id TEXT REFERENCES batches(id),error_code TEXT);
  CREATE INDEX IF NOT EXISTS captures_state ON captures(state,captured_at); PRAGMA user_version=2;`

const states = ['pending', 'uploading', 'acknowledged', 'failed', 'attention'] as const
export interface QueueInspection {
  version: number
  deviceId?: string
  captureCount: number
  batchCount: number
  metadataCount: number
  states: Record<(typeof states)[number], number>
  logicalSha256: string
  capturesSha256: string
  batchesSha256: string
}
export class QueueDataError extends Error {
  readonly code: 'future-version' | 'legacy-version' | 'invalid-data'
  constructor(code: QueueDataError['code'], message: string, cause?: unknown) { super(message, { cause }); this.name = 'QueueDataError'; this.code = code }
}

/** Read-only validation precedes every mutating PRAGMA or recovery UPDATE. */
export function inspectOpenQueue(db: DatabaseSync): QueueInspection {
  const version = Number(db.prepare('PRAGMA user_version').get()!.user_version)
  if (!Number.isSafeInteger(version) || version > QUEUE_VERSION || version < 0) throw new QueueDataError('future-version', '本地采集队列版本过新，未改写。')
  if (db.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok')) throw new QueueDataError('invalid-data', '队列完整性检查失败，原文件保留。')
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new QueueDataError('invalid-data', '队列引用不完整，原文件保留。')
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => String(row.name)))
  if ([...tables].some(name => !['metadata', 'captures', 'batches'].includes(name)) || version > 0 && ['metadata', 'captures', 'batches'].some(name => !tables.has(name))) throw new QueueDataError('invalid-data', '该文件不是兼容的采集队列，未改写。')
  const columns = { metadata: ['key', 'value'], captures: ['id', 'event', 'captured_at', 'state', 'batch_id', 'error_code'], batches: ['id', 'body', 'target', 'state', 'sha', 'error_code'] }
  for (const [table, expected] of Object.entries(columns)) if (tables.has(table)) {
    const actual = db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name))
    if (expected.length !== actual.length || expected.some(name => !actual.includes(name))) throw new QueueDataError('invalid-data', '队列表结构不兼容，原文件保留。')
  }
  const metadata = tables.has('metadata') ? db.prepare('SELECT key,value FROM metadata ORDER BY key').all() : []
  for (const row of metadata) if (typeof row.key !== 'string' || typeof row.value !== 'string') throw new QueueDataError('invalid-data', '队列元数据不合法，原文件保留。')
  const deviceId = metadata.find(row => row.key === 'deviceId')?.value as string | undefined
  if (deviceId && !uuidSchema.safeParse(deviceId).success || version > 0 && !deviceId) throw new QueueDataError('invalid-data', '队列设备身份缺失或不合法，原文件保留。')
  const settings = metadata.find(row => row.key === 'settings')?.value
  if (settings !== undefined) desktopSettingsSchema.parse(JSON.parse(String(settings)))
  const target = metadata.find(row => row.key === 'target')?.value
  if (target !== undefined) z.strictObject({ owner: z.string().regex(/^[A-Za-z0-9-]{1,100}$/), repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/), branch: z.string().min(1).max(200) }).parse(JSON.parse(String(target)))
  if (metadata.some(row => /^(?:pat|token|credentials?|authorization)$/i.test(String(row.key)))) throw new QueueDataError('invalid-data', '队列包含不兼容的旧授权字段，未自动复用或迁移。')
  const result: QueueInspection = { version, deviceId, captureCount: 0, batchCount: 0, metadataCount: metadata.length, states: { pending: 0, uploading: 0, acknowledged: 0, failed: 0, attention: 0 }, logicalSha256: '', capturesSha256: '', batchesSha256: '' }
  const capturesHash = createHash('sha256'), batchesHash = createHash('sha256')
  if (tables.has('captures')) for (const row of db.prepare('SELECT * FROM captures ORDER BY captured_at,id').iterate()) {
    const event = captureEventSchema.parse(JSON.parse(String(row.event)))
    if (event.id !== row.id || event.capturedAt !== row.captured_at || event.deviceId !== deviceId || event.origin !== 'windows' || !states.includes(row.state as (typeof states)[number])) throw new QueueDataError('invalid-data', '队列事件身份或状态不一致，原文件保留。')
    result.captureCount++; result.states[row.state as (typeof states)[number]]++
    capturesHash.update(canonicalJson(row) + '\n')
  }
  if (tables.has('batches')) for (const row of db.prepare('SELECT rowid,* FROM batches ORDER BY rowid').iterate()) {
    const batch = captureBatchSchema.parse(JSON.parse(String(row.body)))
    if (batch.id !== row.id || batch.deviceId !== deviceId || typeof row.target !== 'string' || !row.target || !['prepared', 'uploading', 'acknowledged', 'failed', 'attention'].includes(String(row.state)) || row.sha !== null && !/^[0-9a-f]{40}$/i.test(String(row.sha)) || row.state === 'acknowledged' && row.sha === null) throw new QueueDataError('invalid-data', '冻结批次身份或回执不一致，原文件保留。')
    const records = db.prepare('SELECT event,id,state FROM captures WHERE batch_id=?').all(String(row.id))
    if (records.length !== batch.events.length || batch.events.some(event => !records.some(record => record.id === event.id && canonicalJson(JSON.parse(String(record.event))) === canonicalJson(event))) || row.state === 'acknowledged' && records.some(record => record.state !== 'acknowledged')) throw new QueueDataError('invalid-data', '冻结批次与队列记录不一致，原文件保留。')
    result.batchCount++; batchesHash.update(canonicalJson(row) + '\n')
  }
  if (version === 0 && (result.captureCount || result.batchCount)) throw new QueueDataError('invalid-data', '未标版本的队列含历史记录，不能按新库初始化。')
  result.capturesSha256 = capturesHash.digest('hex'); result.batchesSha256 = batchesHash.digest('hex')
  result.logicalSha256 = createHash('sha256').update(canonicalJson({ metadata, capturesSha256: result.capturesSha256, batchesSha256: result.batchesSha256 })).digest('hex')
  return result
}

export function inspectQueueDatabase(path: string): QueueInspection | undefined {
  if (!existsSync(path)) return undefined
  const db = new DatabaseSync(path, { readOnly: true })
  try { db.exec('PRAGMA busy_timeout=3000'); return inspectOpenQueue(db) }
  finally { db.close() }
}

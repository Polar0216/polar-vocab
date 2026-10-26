import { backup, DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { CREATE_QUEUE_SQL, inspectOpenQueue, inspectQueueDatabase, QUEUE_VERSION, type QueueInspection } from './queue-storage'

const DATABASE = 'captures.sqlite', PENDING = 'migration-pending.json'
const queueFiles = [DATABASE, DATABASE + '-wal', DATABASE + '-shm'] as const
const pendingSchema = z.strictObject({ format: z.literal('polar-vocab-queue-migration'), schemaVersion: z.literal(1), id: z.uuid(), expectedLogicalSha256: z.string().regex(/^[0-9a-f]{64}$/), originalLogicalSha256: z.string().regex(/^[0-9a-f]{64}$/), originalFiles: z.array(z.strictObject({ name: z.enum(queueFiles), sha256: z.string().regex(/^[0-9a-f]{64}$/) })).min(1).max(3) })
type PendingMigration = z.infer<typeof pendingSchema>
export interface MigrationReceipt { sourceDirectory: string; backupDirectory: string; sourceVersion: number; version: number; captures: number; batches: number; sourceLogicalSha256: string; migratedLogicalSha256: string }
export interface PreparedDataDirectory { dataDirectory: string; databasePath: string; action: 'created' | 'existing' | 'migrated' | 'initialized' | 'recovered'; migration?: MigrationReceipt }
export interface PreparationOptions { dataDirectory?: string; legacyDirectory?: string; sourceDirectory?: string }
export class MigrationError extends Error {
  readonly code: 'source-same' | 'target-not-empty' | 'legacy-target' | 'invalid-source' | 'in-progress' | 'publish-failed' | 'recovery-failed'
  constructor(code: MigrationError['code'], message: string, cause?: unknown) { super(message, { cause }); this.name = 'MigrationError'; this.code = code }
}
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const samePath = (a: string, b: string) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)
export const defaultDataDirectory = (appData: string): string => join(resolve(appData), 'Polar Vocab', 'Capture')

function realDirectory(path: string): void {
  // Refuse a selected junction/symlink or linked DB rather than migrating outside it.
  if (existsSync(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())) throw new MigrationError('invalid-source', '数据目录不是普通文件夹，未修改。')
  for (const name of queueFiles) { const file = join(path, name); if (existsSync(file) && (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())) throw new MigrationError('invalid-source', '队列文件不是普通文件，未修改。') }
}
function safeOperationDirectory(dataDirectory: string, id: string): string {
  const folder = join(dataDirectory, 'migration-backups', z.uuid().parse(id)), inside = relative(resolve(dataDirectory), resolve(folder))
  if (inside.startsWith('..' + sep) || inside === '..') throw new MigrationError('recovery-failed', '迁移恢复路径不合法，原文件保留。')
  return folder
}
function saveJson(path: string, value: unknown): void { writeFileSync(path, JSON.stringify(value, null, 2), { flag: 'wx' }) }
function archivePending(pendingPath: string, operation: string, disposition: string): void {
  renameSync(pendingPath, join(operation, `pending-${disposition}-${randomUUID()}.json`))
}

/** A read transaction pins a coherent snapshot while the SQLite backup API includes WAL pages. */
async function snapshot(source: string, destination: string): Promise<QueueInspection> {
  if (existsSync(destination)) throw new MigrationError('in-progress', '备份文件已经存在，未覆盖。')
  const sourceDb = new DatabaseSync(source, { readOnly: true })
  try {
    sourceDb.exec('PRAGMA busy_timeout=3000; BEGIN DEFERRED')
    const before = inspectOpenQueue(sourceDb)
    // Reserve our unique file before backup(), whose API otherwise overwrites a path.
    writeFileSync(destination, '', { flag: 'wx' })
    await backup(sourceDb, destination)
    const after = inspectQueueDatabase(destination)
    if (!after || before.logicalSha256 !== after.logicalSha256 || before.version !== after.version) throw new MigrationError('invalid-source', '在线备份核对失败，原队列保留。')
    return after
  } finally { if (sourceDb.isTransaction) sourceDb.exec('ROLLBACK'); sourceDb.close() }
}
function createVersion2(path: string): void {
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; BEGIN IMMEDIATE')
    try {
      db.exec(CREATE_QUEUE_SQL)
      if (!db.prepare("SELECT value FROM metadata WHERE key='deviceId'").get()) db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('deviceId', randomUUID())
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
    inspectOpenQueue(db)
  } finally { db.close() }
}
function verifyRowsUnchanged(sourceBackup: string, migrated: string): void {
  const a = new DatabaseSync(sourceBackup, { readOnly: true }), b = new DatabaseSync(migrated, { readOnly: true })
  try {
    const before = inspectOpenQueue(a), after = inspectOpenQueue(b)
    if (before.capturesSha256 !== after.capturesSha256 || before.batchesSha256 !== after.batchesSha256 || before.deviceId && before.deviceId !== after.deviceId) throw new MigrationError('invalid-source', '迁移改变了事件、冻结批次或设备身份，未启用。')
    const tables = a.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'").get()
    if (tables) for (const row of a.prepare('SELECT key,value FROM metadata').iterate()) if (b.prepare('SELECT value FROM metadata WHERE key=?').get(String(row.key))?.value !== row.value) throw new MigrationError('invalid-source', '迁移改变了原设置或目标，未启用。')
  } finally { a.close(); b.close() }
}
function receipt(sourceDirectory: string, operation: string, before: QueueInspection, after: QueueInspection): MigrationReceipt {
  return { sourceDirectory, backupDirectory: operation, sourceVersion: before.version, version: QUEUE_VERSION, captures: after.captureCount, batches: after.batchCount, sourceLogicalSha256: before.logicalSha256, migratedLogicalSha256: after.logicalSha256 }
}
function writeRollback(operation: string, sourceDirectory: string): void {
  writeFileSync(join(operation, 'ROLLBACK.txt'), `Polar Vocab Capture migration rollback\n\nThe original source directory was opened read-only and remains available:\n${sourceDirectory}\n\nsource.sqlite is a validated SQLite online backup including committed WAL data. It keeps the source user_version for the corresponding older application.\nClose the application before rollback. Open the unchanged source with its matching old version, or COPY source.sqlite to a new empty data folder using that older version. Never open the new version-2 queue using 0.4.x/0.5.0. Do not replace a queue that has new captures: export/back up both first.\nAll backup and failed-stage files are retained; no automatic cleanup.\n`, { flag: 'wx' })
}

/** Finishes an already published import or restores every moved target file. No files are deleted. */
export function recoverPendingMigration(dataDirectory: string): boolean {
  const pendingPath = join(dataDirectory, PENDING)
  if (!existsSync(pendingPath)) return false
  let pending: PendingMigration
  try { pending = pendingSchema.parse(JSON.parse(readFileSync(pendingPath, 'utf8'))) }
  catch (error) { throw new MigrationError('recovery-failed', '迁移日志不合法，已停止启动；备份与队列保留。', error) }
  const operation = safeOperationDirectory(dataDirectory, pending.id), retained = join(operation, 'retained-target'), databasePath = join(dataDirectory, DATABASE)
  try {
    const current = inspectQueueDatabase(databasePath)
    if (current?.version === QUEUE_VERSION && current.logicalSha256 === pending.expectedLogicalSha256) {
      saveJson(join(operation, `recovery-completed-${randomUUID()}.json`), { at: new Date().toISOString(), action: 'published-queue-verified' })
      archivePending(pendingPath, operation, 'completed'); return true
    }
  } catch { /* A partial publish is restored from retained files below. */ }
  try {
    for (const original of pending.originalFiles) {
      const from = join(retained, original.name), to = join(dataDirectory, original.name)
      if (!existsSync(from)) {
        if (!existsSync(to) || digest(to) !== original.sha256) throw new Error('Original queue file missing')
        continue
      }
      if (existsSync(to)) renameSync(to, join(operation, 'unconfirmed-' + randomUUID() + '-' + original.name))
      renameSync(from, to)
      if (digest(to) !== original.sha256) throw new Error('Original queue file hash mismatch')
    }
    const restored = inspectQueueDatabase(databasePath)
    if (!restored || restored.logicalSha256 !== pending.originalLogicalSha256) throw new Error('Restored logical data mismatch')
    saveJson(join(operation, `recovery-rolled-back-${randomUUID()}.json`), { at: new Date().toISOString(), action: 'original-target-restored' })
    archivePending(pendingPath, operation, 'rolled-back'); return true
  } catch (error) { throw new MigrationError('recovery-failed', '迁移尚未恢复，已停止启动。原始源、在线备份与恢复资料全部保留。', error) }
}

/** Requires the caller to close its queue and stop sync/auth first; never merges two device histories. */
export async function importIntoEmptyDataDirectory(dataDirectoryInput: string, sourceDirectoryInput: string): Promise<MigrationReceipt> {
  const dataDirectory = resolve(dataDirectoryInput), sourceDirectory = resolve(sourceDirectoryInput)
  if (samePath(dataDirectory, sourceDirectory)) throw new MigrationError('source-same', '源与目标必须是不同目录；原队列不会原地升级。')
  realDirectory(dataDirectory); realDirectory(sourceDirectory)
  recoverPendingMigration(dataDirectory)
  const databasePath = join(dataDirectory, DATABASE), original = inspectQueueDatabase(databasePath)
  if (!original || original.captureCount || original.batchCount || ![0, QUEUE_VERSION].includes(original.version)) throw new MigrationError('target-not-empty', '只能迁入尚无事件及批次的新版队列；没有混并或覆盖原记录。')
  if (!existsSync(join(sourceDirectory, DATABASE))) throw new MigrationError('invalid-source', '所选目录没有采集数据库，未迁移。')
  const id = randomUUID(), operation = safeOperationDirectory(dataDirectory, id)
  mkdirSync(operation, { recursive: true })
  const sourceBackup = join(operation, 'source.sqlite'), before = await snapshot(join(sourceDirectory, DATABASE), sourceBackup)
  await snapshot(databasePath, join(operation, 'target-before.sqlite'))
  const migrated = join(operation, 'migrated.sqlite')
  copyFileSync(sourceBackup, migrated, constants.COPYFILE_EXCL); createVersion2(migrated); verifyRowsUnchanged(sourceBackup, migrated)
  const after = inspectQueueDatabase(migrated)!, result = receipt(sourceDirectory, operation, before, after)
  saveJson(join(operation, 'manifest.json'), { format: 'polar-vocab-migration-receipt', schemaVersion: 1, at: new Date().toISOString(), ...result, sourceFileSha256: digest(sourceBackup), migratedFileSha256: digest(migrated) })
  writeRollback(operation, sourceDirectory)
  const originalFiles = queueFiles.filter(name => existsSync(join(dataDirectory, name))).map(name => ({ name, sha256: digest(join(dataDirectory, name)) }))
  mkdirSync(join(operation, 'retained-target'))
  saveJson(join(dataDirectory, PENDING), pendingSchema.parse({ format: 'polar-vocab-queue-migration', schemaVersion: 1, id, expectedLogicalSha256: after.logicalSha256, originalLogicalSha256: original.logicalSha256, originalFiles }))
  try {
    for (const file of originalFiles) renameSync(join(dataDirectory, file.name), join(operation, 'retained-target', file.name))
    renameSync(migrated, databasePath)
    const published = inspectQueueDatabase(databasePath)
    if (!published || published.logicalSha256 !== after.logicalSha256 || published.version !== QUEUE_VERSION) throw new Error('Published queue verification failed')
    archivePending(join(dataDirectory, PENDING), operation, 'completed')
    return result
  } catch (error) {
    recoverPendingMigration(dataDirectory)
    // A publication that was fully committed before a bookkeeping failure is
    // accepted by recovery; do not tell the user an old empty queue was restored.
    const recovered = inspectQueueDatabase(databasePath)
    if (recovered?.version === QUEUE_VERSION && recovered.logicalSha256 === after.logicalSha256) return result
    throw new MigrationError('publish-failed', '迁移未启用，原目标已恢复；源、备份与失败资料保留。', error)
  }
}

/** Prepares a fresh app-data directory before Electron opens Chromium storage. */
export async function prepareDataDirectory(appData: string, options: PreparationOptions = {}): Promise<PreparedDataDirectory> {
  const dataDirectory = resolve(options.dataDirectory ?? defaultDataDirectory(appData)), legacyDirectory = resolve(options.legacyDirectory ?? join(appData, 'Polar Vocab Capture')), databasePath = join(dataDirectory, DATABASE)
  if (samePath(dataDirectory, legacyDirectory)) throw new MigrationError('source-same', '新版数据目录不能直接使用旧版默认目录。')
  realDirectory(dataDirectory)
  const recovered = existsSync(dataDirectory) && recoverPendingMigration(dataDirectory)
  const existing = inspectQueueDatabase(databasePath)
  if (existing) {
    if (existing.version === 1) throw new MigrationError('legacy-target', '此目录仍是旧版队列；请选择另一新版目录，通过备份迁移，未改写原库。')
    if (options.sourceDirectory) return { dataDirectory, databasePath, action: 'migrated', migration: await importIntoEmptyDataDirectory(dataDirectory, options.sourceDirectory) }
    if (existing.version === 0) {
      const operation = safeOperationDirectory(dataDirectory, randomUUID()); mkdirSync(operation, { recursive: true })
      await snapshot(databasePath, join(operation, 'source.sqlite')); createVersion2(databasePath)
      saveJson(join(operation, 'initialization.json'), { at: new Date().toISOString(), previousVersion: 0, version: QUEUE_VERSION, previousLogicalSha256: existing.logicalSha256 })
      return { dataDirectory, databasePath, action: 'initialized' }
    }
    return { dataDirectory, databasePath, action: recovered ? 'recovered' : 'existing' }
  }
  // Refuse partial/nonempty directories instead of interpreting a missing DB as data deletion.
  if (existsSync(dataDirectory) && readdirSync(dataDirectory).length) throw new MigrationError('invalid-source', '数据目录缺少队列但已有其他资料，未创建空库覆盖。')
  const sourceDirectory = options.sourceDirectory ? resolve(options.sourceDirectory) : !options.dataDirectory && existsSync(join(legacyDirectory, DATABASE)) ? legacyDirectory : undefined
  if (sourceDirectory && samePath(sourceDirectory, dataDirectory)) throw new MigrationError('source-same', '迁移源与新目录相同，未改写。')
  if (sourceDirectory) realDirectory(sourceDirectory)
  mkdirSync(dirname(dataDirectory), { recursive: true })
  const staging = join(dirname(dataDirectory), basename(dataDirectory) + '.preparing-' + randomUUID())
  mkdirSync(staging)
  let migration: MigrationReceipt | undefined
  if (sourceDirectory) {
    const operation = safeOperationDirectory(staging, randomUUID()); mkdirSync(operation, { recursive: true })
    const sourceBackup = join(operation, 'source.sqlite'), before = await snapshot(join(sourceDirectory, DATABASE), sourceBackup)
    copyFileSync(sourceBackup, join(staging, DATABASE), constants.COPYFILE_EXCL); createVersion2(join(staging, DATABASE)); verifyRowsUnchanged(sourceBackup, join(staging, DATABASE))
    migration = receipt(sourceDirectory, operation, before, inspectQueueDatabase(join(staging, DATABASE))!)
    saveJson(join(operation, 'manifest.json'), { format: 'polar-vocab-migration-receipt', schemaVersion: 1, at: new Date().toISOString(), ...migration, backupDirectory: relative(staging, operation), sourceFileSha256: digest(sourceBackup), migratedFileSha256: digest(join(staging, DATABASE)) })
    writeRollback(operation, sourceDirectory)
  } else createVersion2(join(staging, DATABASE))
  if (existsSync(dataDirectory)) {
    // An empty pre-created test directory is retained alongside the new profile.
    if (readdirSync(dataDirectory).length) throw new MigrationError('in-progress', '目标目录已变化，未覆盖。迁移副本与备份保留。')
    renameSync(dataDirectory, dataDirectory + '.empty-before-' + randomUUID())
  }
  renameSync(staging, dataDirectory)
  if (migration) migration.backupDirectory = join(dataDirectory, relative(staging, migration.backupDirectory))
  return { dataDirectory, databasePath, action: migration ? 'migrated' : 'created', ...(migration ? { migration } : {}) }
}

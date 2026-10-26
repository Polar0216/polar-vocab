import { describe, expect, it } from 'vitest'
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { canonicalJson, captureBatchSchema, type CaptureEvent } from '../../../packages/shared'
import { defaultSettings } from '../src/contracts'
import { CaptureQueue } from '../src/queue'
import { CREATE_QUEUE_SQL, inspectQueueDatabase } from '../src/queue-storage'
import { defaultDataDirectory, importIntoEmptyDataDirectory, prepareDataDirectory, recoverPendingMigration } from '../src/migration'

const root = resolve('.cache/integrated-migration-tests'); mkdirSync(root, { recursive: true })
const folder = () => mkdtempSync(join(root, 'case-'))
const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
function legacy(directory: string, options: { liveWal?: boolean; version?: number } = {}) {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, 'captures.sqlite'), db = new DatabaseSync(path), deviceId = randomUUID()
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;'); db.exec(CREATE_QUEUE_SQL)
  db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('deviceId', deviceId)
  db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('settings', canonicalJson({ ...defaultSettings, autoSync: true }))
  db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('target', canonicalJson({ owner: 'capture-test', repository: 'data', branch: 'main' }))
  const capturedAt = '2026-10-18T01:00:00.000Z'
  const event: CaptureEvent = { id: randomUUID(), schemaVersion: 1, deviceId, capturedAt, origin: 'windows', payload: { lang: 'en', lemma: 'artificial-migration', meanings: ['人工迁移记录'] } }
  const batch = captureBatchSchema.parse({ format: 'polar-vocab-capture-batch', protocolVersion: 1, schemaVersion: 1, id: randomUUID(), deviceId, month: '2026-10', events: [event] })
  db.prepare('INSERT INTO batches(id,body,target,state,sha) VALUES(?,?,?,?,?)').run(batch.id, canonicalJson(batch), 'artificial-target', 'acknowledged', 'a'.repeat(40))
  db.prepare('INSERT INTO captures(id,event,captured_at,state,batch_id) VALUES(?,?,?,?,?)').run(event.id, canonicalJson(event), capturedAt, 'acknowledged', batch.id)
  const pending = { ...event, id: randomUUID(), payload: { lang: 'de' as const, lemma: 'Prüfwort', de: { article: 'das' as const, plural: 'Prüfwörter' } } }
  db.prepare('INSERT INTO captures(id,event,captured_at,state) VALUES(?,?,?,?)').run(pending.id, canonicalJson(pending), capturedAt, 'pending')
  db.exec('PRAGMA user_version=' + (options.version ?? 1))
  if (!options.liveWal) db.close()
  return { path, event, pending, batch, deviceId, db: options.liveWal ? db : undefined }
}
function assertSourceRows(path: string, events: CaptureEvent[], batchId: string) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    for (const event of events) expect(db.prepare('SELECT event FROM captures WHERE id=?').get(event.id)?.event).toBe(canonicalJson(event))
    expect(db.prepare('SELECT sha,state FROM batches WHERE id=?').get(batchId)).toEqual({ sha: 'a'.repeat(40), state: 'acknowledged' })
  } finally { db.close() }
}

describe('version-2 SQLite guard and actual online migration', () => {
  it('creates one stable default profile and rejects directly opening legacy/future queues before writes', async () => {
    const appData = folder(), prepared = await prepareDataDirectory(appData)
    expect(prepared.dataDirectory).toBe(join(appData, 'Polar Vocab', 'Capture'))
    expect(defaultDataDirectory(appData)).toBe(prepared.dataDirectory)
    expect(prepared.action).toBe('created'); expect(inspectQueueDatabase(prepared.databasePath)?.version).toBe(2)
    expect((await prepareDataDirectory(appData)).action).toBe('existing')
    const old = legacy(join(appData, 'legacy-other')), before = digest(old.path)
    expect(() => new CaptureQueue(old.path)).toThrow('先备份迁移'); expect(digest(old.path)).toBe(before)
    const future = legacy(join(appData, 'future'), { version: 99 }), hash = digest(future.path)
    expect(() => new CaptureQueue(future.path)).toThrow('版本过新'); expect(digest(future.path)).toBe(hash)
  })
  it('backs up a live WAL snapshot, migrates only its copy, and preserves event/batch/ACK identity', async () => {
    const appData = folder(), sourceDirectory = join(appData, 'Polar Vocab Capture'), source = legacy(sourceDirectory, { liveWal: true })
    try {
      expect(existsSync(source.path + '-wal')).toBe(true)
      const prepared = await prepareDataDirectory(appData), receipt = prepared.migration!
      expect(prepared.action).toBe('migrated'); expect(receipt.sourceVersion).toBe(1); expect(receipt.version).toBe(2)
      expect(receipt.captures).toBe(2); expect(receipt.batches).toBe(1)
      expect(inspectQueueDatabase(source.path)?.version).toBe(1)
      expect(inspectQueueDatabase(prepared.databasePath)?.deviceId).toBe(source.deviceId)
      expect(receipt.sourceLogicalSha256).toBe(receipt.migratedLogicalSha256)
      assertSourceRows(prepared.databasePath, [source.event, source.pending], source.batch.id)
      const backup = join(receipt.backupDirectory, 'source.sqlite')
      expect(inspectQueueDatabase(backup)?.version).toBe(1)
      assertSourceRows(backup, [source.event, source.pending], source.batch.id)
      expect(existsSync(join(receipt.backupDirectory, 'ROLLBACK.txt'))).toBe(true)
      const queue = new CaptureQueue(prepared.databasePath)
      try { expect(queue.deviceId).toBe(source.deviceId); expect(queue.counts()).toMatchObject({ pending: 1, acknowledged: 1 }); expect(queue.find(source.event.id)).toEqual(source.event) } finally { queue.close() }
      // The old instance may keep collecting: new writes do not rewrite the committed snapshot.
      const later = { ...source.pending, id: randomUUID() }
      source.db!.prepare('INSERT INTO captures(id,event,captured_at,state) VALUES(?,?,?,?)').run(later.id, canonicalJson(later), later.capturedAt, 'pending')
      expect(inspectQueueDatabase(source.path)?.captureCount).toBe(3)
      expect(inspectQueueDatabase(prepared.databasePath)?.captureCount).toBe(2)
      expect((await prepareDataDirectory(appData)).action).toBe('existing')
    } finally { source.db?.close() }
  })
  it('initializes only empty version0 metadata fixtures and keeps a complete pre-initialization backup', async () => {
    const appData = folder(), dataDirectory = join(appData, 'explicit-test'); mkdirSync(dataDirectory)
    const db = new DatabaseSync(join(dataDirectory, 'captures.sqlite')); db.exec('CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
    db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('settings', canonicalJson({ ...defaultSettings, shortcut: 'Control+Alt+D' })); db.close()
    const prepared = await prepareDataDirectory(appData, { dataDirectory })
    expect(prepared.action).toBe('initialized'); expect(inspectQueueDatabase(prepared.databasePath)?.version).toBe(2)
    const queue = new CaptureQueue(prepared.databasePath); try { expect(queue.settings().shortcut).toBe('Control+Alt+D') } finally { queue.close() }
  })
  it('imports an explicitly selected candidate into an empty formal queue, never merges nonempty targets', async () => {
    const appData = folder(), prepared = await prepareDataDirectory(appData), sourceDirectory = join(appData, 'selected-0.5-candidate'), source = legacy(sourceDirectory)
    const before = digest(source.path), receipt = await importIntoEmptyDataDirectory(prepared.dataDirectory, sourceDirectory)
    expect(digest(source.path)).toBe(before)
    expect(receipt.captures).toBe(2); expect(existsSync(join(receipt.backupDirectory, 'target-before.sqlite'))).toBe(true)
    assertSourceRows(prepared.databasePath, [source.event, source.pending], source.batch.id)
    await expect(importIntoEmptyDataDirectory(prepared.dataDirectory, sourceDirectory)).rejects.toMatchObject({ code: 'target-not-empty' })
    expect(digest(source.path)).toBe(before)
    await expect(importIntoEmptyDataDirectory(sourceDirectory, sourceDirectory)).rejects.toMatchObject({ code: 'source-same' })
  })
  it('does not reinterpret invalid queues, unexpected tables, missing DBs or old override directories as fresh data', async () => {
    const appData = folder(), sourceDirectory = join(appData, 'Polar Vocab Capture'); mkdirSync(sourceDirectory)
    const badPath = join(sourceDirectory, 'captures.sqlite'); writeFileSync(badPath, 'artificial corrupted database')
    const hash = digest(badPath)
    await expect(prepareDataDirectory(appData)).rejects.toThrow(); expect(digest(badPath)).toBe(hash)
    expect(existsSync(join(defaultDataDirectory(appData), 'captures.sqlite'))).toBe(false)
    const old = legacy(join(appData, 'old-explicit'))
    await expect(prepareDataDirectory(appData, { dataDirectory: join(appData, 'old-explicit') })).rejects.toMatchObject({ code: 'legacy-target' })
    expect(inspectQueueDatabase(old.path)?.version).toBe(1)
    const incomplete = join(appData, 'incomplete'); mkdirSync(incomplete); writeFileSync(join(incomplete, 'keep-evidence.txt'), 'Artificial evidence')
    await expect(prepareDataDirectory(appData, { dataDirectory: incomplete })).rejects.toThrow('已有其他资料')
    expect(readFileSync(join(incomplete, 'keep-evidence.txt'), 'utf8')).toBe('Artificial evidence')
  })
  it('refuses unreadable target metadata or old plaintext authorization fields before any migration write', async () => {
    const appData = folder(), sourceDirectory = join(appData, 'Polar Vocab Capture'), source = legacy(sourceDirectory)
    const fault = new DatabaseSync(source.path)
    fault.prepare('UPDATE metadata SET value=? WHERE key=?').run('{not-json', 'target'); fault.close()
    const before = digest(source.path)
    await expect(prepareDataDirectory(appData)).rejects.toThrow()
    expect(digest(source.path)).toBe(before)
    const plain = legacy(join(appData, 'plain-old')), db = new DatabaseSync(plain.path)
    db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('token', 'artificial-legacy-value'); db.close()
    expect(() => inspectQueueDatabase(plain.path)).toThrow('未自动复用或迁移')
  })
})

describe('interrupted import journal recovery, using real files/databases', () => {
  it('restores an empty original target after a crash between old-file rename and publish', async () => {
    const appData = folder(), prepared = await prepareDataDirectory(appData), original = inspectQueueDatabase(prepared.databasePath)!
    const id = randomUUID(), operation = join(prepared.dataDirectory, 'migration-backups', id), retained = join(operation, 'retained-target')
    mkdirSync(retained, { recursive: true }); const sha256 = digest(prepared.databasePath)
    writeFileSync(join(prepared.dataDirectory, 'migration-pending.json'), JSON.stringify({ format: 'polar-vocab-queue-migration', schemaVersion: 1, id, expectedLogicalSha256: 'a'.repeat(64), originalLogicalSha256: original.logicalSha256, originalFiles: [{ name: 'captures.sqlite', sha256 }] }))
    renameSync(prepared.databasePath, join(retained, 'captures.sqlite'))
    expect((await prepareDataDirectory(appData)).action).toBe('recovered')
    expect(inspectQueueDatabase(prepared.databasePath)?.logicalSha256).toBe(original.logicalSha256)
    expect(readdirSync(operation).some(name => name.startsWith('pending-rolled-back-'))).toBe(true)
  })
  it('accepts a fully published valid queue after a crash before removing the pending marker', async () => {
    const appData = folder(), prepared = await prepareDataDirectory(appData), source = legacy(join(appData, 'candidate'))
    const imported = await importIntoEmptyDataDirectory(prepared.dataDirectory, join(appData, 'candidate'))
    const completed = join(imported.backupDirectory, readdirSync(imported.backupDirectory).find(name => name.startsWith('pending-completed-'))!)
    copyFileSync(completed, join(prepared.dataDirectory, 'migration-pending.json'), constants.COPYFILE_EXCL)
    // Retain the previous completion evidence and choose another unique marker path.
    renameSync(completed, join(imported.backupDirectory, 'original-completion.json'))
    expect(recoverPendingMigration(prepared.dataDirectory)).toBe(true)
    assertSourceRows(prepared.databasePath, [source.event, source.pending], source.batch.id)
    expect(readdirSync(imported.backupDirectory).some(name => name.startsWith('recovery-completed-'))).toBe(true)
  })
  it('rejects malformed/path-traversal journals without deleting any evidence', async () => {
    const appData = folder(), prepared = await prepareDataDirectory(appData), pending = join(prepared.dataDirectory, 'migration-pending.json')
    writeFileSync(pending, JSON.stringify({ id: '../outside', format: 'polar-vocab-queue-migration' }))
    await expect(prepareDataDirectory(appData)).rejects.toMatchObject({ code: 'recovery-failed' })
    expect(existsSync(pending)).toBe(true); expect(inspectQueueDatabase(prepared.databasePath)?.captureCount).toBe(0)
  })
})

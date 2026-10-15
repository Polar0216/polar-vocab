import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { PolarDatabase, V2_STORES } from '../../../src/storage/database'
import { LocalVocabularyService } from '../../../src/features/vocabulary/service'
import { SyncEngine } from '../../../src/features/sync/engine'
import { GitHubClient } from '../../../src/integrations/github/client'
import { decodeSnapshot, encodeSnapshot } from '../../../src/features/sync/protocol'
import { LocalReviewService } from '../../../src/features/review/service'
import { LocalBackupService } from '../../../src/features/import-export/backup-service'
import { resolveConflict } from '../../../src/features/sync/resolutions'
import { capture } from '../domain/fixtures'
import { FakeGitHub } from './fake-github'
const apps: { local: LocalVocabularyService; engine: SyncEngine }[] = []
function app(name = crypto.randomUUID()) { const local = new LocalVocabularyService(new PolarDatabase(name)); const engine = new SyncEngine(local); const value = { local, engine }; apps.push(value); return value }
async function connect(engine: SyncEngine, fake: FakeGitHub) { const preview = await engine.test({ owner: 'example', repository: 'private-data', branch: '' }, '', new GitHubClient('artificial-session-value', fake.fetch)); await engine.confirm(preview) }
async function retry(engine: SyncEngine) { const connection = await engine.connection(); if (connection) await engine.service.db.connections.put({ ...connection, retryAt: 0 }); return engine.synchronize() }
afterEach(async () => { for (const value of apps) { await value.engine.disconnect().catch(() => undefined); await value.local.db.delete() } apps.length = 0 })
describe('two independent devices, real FSRS, persisted sync attempts', () => {
  it('initializes once, downloads and unions distinct offline additions without redundant commits', async () => {
    const a = app(), b = app(), fake = new FakeGitHub(); const first = await a.local.add({ lang: 'en', lemma: 'A' }); await connect(a.engine, fake); await connect(b.engine, fake)
    expect(await b.local.get(first.id)).toBeDefined()
    await a.local.add({ lang: 'de', lemma: 'B' }); await b.local.add({ lang: 'en', lemma: 'C' }); await a.engine.synchronize(); await b.engine.synchronize(); await a.engine.synchronize()
    expect((await a.local.list()).map((entry) => entry.lemma).sort()).toEqual(['A', 'B', 'C']); expect(await a.local.db.pendingOperations.count()).toBe(0)
    const version = fake.version; await b.engine.synchronize(); await a.engine.synchronize(); expect(fake.version).toBe(version)
    const raw = JSON.parse(fake.text!); expect(raw).toMatchObject({ format: 'polar-vocab-state', protocolVersion: 1 }); expect(raw).not.toHaveProperty('local')
  })
  it('merges independent fields and routes same fields through explicit decision', async () => {
    const a = app(), b = app(), fake = new FakeGitHub(); let word = await a.local.add({ lang: 'en', lemma: 'shared', meanings: ['old'] }); await connect(a.engine, fake); await connect(b.engine, fake)
    await a.local.update(word.id, { lang: 'en', lemma: 'shared', meanings: ['new'] }, { expectedRevisionId: word.revisionId }); await b.local.batchUpdate([word.id], { addTags: ['tag'] }); await a.engine.synchronize(); await b.engine.synchronize(); await a.engine.synchronize()
    word = (await a.local.get(word.id))!; expect(word.tags).toEqual(['tag']); expect(word.meanings).toEqual(['new'])
    await a.local.update(word.id, { lang: 'en', lemma: 'shared', meanings: ['left'], tags: ['tag'] }, { expectedRevisionId: word.revisionId })
    const bw = (await b.local.get(word.id))!; await b.local.update(word.id, { lang: 'en', lemma: 'shared', meanings: ['right'], tags: ['tag'] }, { expectedRevisionId: bw.revisionId })
    await a.engine.synchronize(); const version = fake.version; expect(await b.engine.synchronize()).toBe('conflict'); expect(fake.version).toBe(version)
    const conflict = (await b.local.db.conflicts.toArray())[0]; await resolveConflict(b.local, conflict.id, 'local'); await b.engine.synchronize(); await a.engine.synchronize(); expect((await a.local.get(word.id))?.meanings).toEqual(['right'])
  })
  it('never revives a deletion and keeps an edited audit copy', async () => {
    const a = app(), b = app(), fake = new FakeGitHub(); const word = await a.local.add({ lang: 'en', lemma: 'deleted' }); await connect(a.engine, fake); await connect(b.engine, fake)
    await a.local.softDelete([word.id]); await b.local.batchUpdate([word.id], { addTags: ['offline-edit'] }); await a.engine.synchronize(); expect(await b.engine.synchronize()).toBe('conflict'); expect(await b.local.get(word.id)).toBeUndefined()
    const conflict = (await b.local.db.conflicts.toArray())[0]; expect(conflict.kind).toBe('delete-vs-edit'); await resolveConflict(b.local, conflict.id, 'keep-deleted'); await b.engine.synchronize(); expect((await decodeSnapshot(fake.text!)).tombstones.length).toBeGreaterThan(0); expect(await b.local.db.conflictDecisions.count()).toBe(1)
  })
  it('deduplicates the same capture ingested independently', async () => {
    const a = app(), b = app(), fake = new FakeGitHub(); await connect(a.engine, fake); await connect(b.engine, fake)
    await a.local.ingest([capture()]); await b.local.ingest([capture()]); await a.engine.synchronize(); await b.engine.synchronize(); const remote = await decodeSnapshot(fake.text!); expect(remote.vocabularies).toHaveLength(1); expect(remote.captures).toHaveLength(1); expect(remote.ingestedCaptureIds).toHaveLength(1)
  })
  it('detects different UUID cards for the same word/template and preserves deleted history', async () => {
    const a = app(), b = app(), fake = new FakeGitHub(); const word = await a.local.add({ lang: 'en', lemma: 'template', meanings: ['人工'], status: 'learning' }); await connect(a.engine, fake); await connect(b.engine, fake)
    const ar = new LocalReviewService(a.local), br = new LocalReviewService(b.local); const ac = (await ar.create(await ar.previewCreate([word.id])))[0]; await br.create(await br.previewCreate([word.id])); await a.engine.synchronize(); expect(await b.engine.synchronize()).toBe('conflict'); expect((await br.dashboard()).queue).toHaveLength(0)
    const conflict = (await b.local.db.conflicts.toArray()).find((c) => c.fields.includes('duplicate-template'))!; await resolveConflict(b.local, conflict.id, 'card', ac.id); await b.engine.synchronize(); await a.engine.synchronize(); expect((await decodeSnapshot(fake.text!)).cards.filter((c) => !c.deletedAt)).toHaveLength(1)
  })
  it('preserves both offline reviews, syncs a resolution and grades its legal successor', async () => {
    const a = app(), b = app(), fake = new FakeGitHub(); const word = await a.local.add({ lang: 'en', lemma: 'fork', meanings: ['人工'], status: 'learning' }); const ar = new LocalReviewService(a.local), br = new LocalReviewService(b.local); const card = (await ar.create(await ar.previewCreate([word.id])))[0]; await connect(a.engine, fake); await connect(b.engine, fake)
    const ae = await ar.grade({ eventId: crypto.randomUUID(), cardId: card.id, expectedRevisionId: card.revisionId, expectedStateId: card.stateId, rating: 'Good' }); await br.grade({ eventId: crypto.randomUUID(), cardId: card.id, expectedRevisionId: card.revisionId, expectedStateId: card.stateId, rating: 'Again' }); await a.engine.synchronize(); expect(await b.engine.synchronize()).toBe('conflict'); expect(await b.local.db.reviewEvents.count()).toBe(2); expect((await br.dashboard()).blockedCards).toContain(card.id)
    expect(await b.local.db.conflicts.count()).toBe(1)
    const conflict = (await b.local.db.conflicts.toArray()).find((c) => c.kind === 'review-branch')!; await resolveConflict(b.local, conflict.id, 'review', ae.event.id); await b.engine.synchronize(); await a.engine.synchronize()
    const resolved = (await a.local.db.cards.get(card.id))!, time = new Date(Date.parse(resolved.fsrsState.due) + 1)
    const next = await new LocalReviewService(a.local, () => time).grade({ eventId: crypto.randomUUID(), cardId: card.id, expectedRevisionId: resolved.revisionId, expectedStateId: resolved.stateId, rating: 'Good' }); expect(next.event.parentResolutionId).toBeDefined(); await a.engine.synchronize(); await b.engine.synchronize(); await b.engine.synchronize(); expect(await b.local.db.reviewEvents.count()).toBe(3); expect(await b.local.db.reviewResolutions.count()).toBe(1)
    const backup = JSON.parse(await new LocalBackupService(b.local).exportBackup().then((blob) => blob.text())); expect(JSON.stringify(backup)).not.toContain('artificial-session-value')
    const corrupted = JSON.parse(fake.text!); corrupted.snapshot.cards[0].fsrsState.stability += 1
    await expect(decodeSnapshot(JSON.stringify(corrupted))).rejects.toThrow('协议')
  })
  it('preserves writes during upload and recovers a response lost after remote commit across a new engine', async () => {
    const a = app(), fake = new FakeGitHub(); await connect(a.engine, fake); await a.local.add({ lang: 'en', lemma: 'frozen' })
    fake.beforePut = async () => { fake.beforePut = undefined; await a.local.add({ lang: 'de', lemma: 'later' }) }; fake.dropResponse = true
    await expect(a.engine.synchronize()).rejects.toThrow(); expect(await a.local.db.syncJobs.count()).toBe(1); const pending = await a.local.db.pendingOperations.count(); expect(pending).toBe(2)
    const resumed = new SyncEngine(a.local); const version = fake.version; await connect(resumed, fake); expect(fake.version).toBe(version); expect(await a.local.db.pendingOperations.count()).toBe(1); expect((await a.local.list()).map((w) => w.lemma).sort()).toEqual(['frozen', 'later']); await resumed.synchronize(); expect((await decodeSnapshot(fake.text!)).vocabularies).toHaveLength(2); await resumed.disconnect()
  })
  it('recovers PUT-success/ACK-transaction failure without duplicate write', async () => {
    const a = app(), fake = new FakeGitHub(); await connect(a.engine, fake); await a.local.add({ lang: 'en', lemma: 'ack' })
    const fail = () => { throw new Error('injected ACK') }; a.local.db.syncBases.hook('creating', fail)
    await expect(a.engine.synchronize()).rejects.toThrow(); a.local.db.syncBases.hook('creating').unsubscribe(fail); expect(await a.local.db.pendingOperations.count()).toBe(1); expect(await a.local.db.syncJobs.count()).toBe(1); const version = fake.version; await retry(a.engine); expect(fake.version).toBe(version); expect(await a.local.db.pendingOperations.count()).toBe(0)
  })
  it('re-reads after stale SHA and merges a concurrent device addition', async () => {
    const a = app(), b = app(), fake = new FakeGitHub(); await connect(a.engine, fake); await connect(b.engine, fake); await a.local.add({ lang: 'en', lemma: 'A' }); await b.local.add({ lang: 'de', lemma: 'B' })
    fake.beforePut = async () => { fake.beforePut = undefined; await b.engine.synchronize() }; await a.engine.synchronize(); expect((await decodeSnapshot(fake.text!)).vocabularies.map((w) => w.lemma).sort()).toEqual(['A', 'B'])
  })
  it.each([401, 403, 404, 422, 429, 503])('failure %s preserves pending and local data', async (status) => {
    const a = app(), fake = new FakeGitHub(); await connect(a.engine, fake); const word = await a.local.add({ lang: 'en', lemma: 'preserved' }); fake.status = status
    await expect(a.engine.synchronize()).rejects.toThrow(); expect(await a.local.get(word.id)).toBeDefined(); expect(await a.local.db.pendingOperations.count()).toBe(1); expect(await a.local.db.syncJobs.count()).toBe(1)
  })
  it('blocks incompatible/manual remote edits and file deletion without losing local work', async () => {
    const a = app(), fake = new FakeGitHub(); await connect(a.engine, fake); await a.local.add({ lang: 'en', lemma: 'safe' }); const original = fake.text!
    fake.text = JSON.stringify({ ...JSON.parse(original), protocolVersion: 99 }); fake.version++; await expect(a.engine.synchronize()).rejects.toThrow(); expect(await a.local.db.pendingOperations.count()).toBe(1)
    fake.text = null; fake.version++; await expect(retry(a.engine)).rejects.toThrow('消失'); expect(fake.text).toBeNull()
  })
  it('serializes two tabs through a persisted lease and migrates populated v2 in place', async () => {
    const name = crypto.randomUUID(), legacy = new Dexie(name); legacy.version(2).stores(V2_STORES); await legacy.table('ingestedCaptures').count(); legacy.close(); const a = app(name), b = app(name), fake = new FakeGitHub(); await connect(a.engine, fake); await connect(b.engine, fake); expect(a.local.db.verno).toBe(3)
    await a.local.add({ lang: 'en', lemma: 'locked' }); let release!: () => void; const hold = new Promise<void>((resolve) => { release = resolve }); let started!: () => void; const signal = new Promise<void>((resolve) => { started = resolve }); fake.beforePut = async () => { started(); await hold }
    const running = a.engine.synchronize(); await signal; await expect(b.engine.synchronize()).rejects.toThrow('标签页'); release(); await running
  })
  it('canonicalizes collection order while preserving meaningful array order', async () => {
    const a = app(); await a.local.add({ lang: 'en', lemma: 'one' }); await a.local.add({ lang: 'de', lemma: 'two' }); const snapshot = await a.local.snapshot(); const swapped = { ...snapshot, vocabularies: [...snapshot.vocabularies].reverse() }; expect(encodeSnapshot(snapshot)).toBe(encodeSnapshot(swapped))
  })
})

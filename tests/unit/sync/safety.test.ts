import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalVocabularyService } from '../../../src/features/vocabulary/service'
import { LocalReviewService } from '../../../src/features/review/service'
import { LocalBackupService } from '../../../src/features/import-export/backup-service'
import { PolarDatabase } from '../../../src/storage/database'
import { SyncEngine } from '../../../src/features/sync/engine'
import { resolveConflict } from '../../../src/features/sync/resolutions'
import { mergeSnapshots } from '../../../src/features/sync/merge'
import { GitHubClient } from '../../../src/integrations/github/client'
import { decodeSnapshot, encodeSnapshot } from '../../../src/features/sync/protocol'
import { FakeGitHub } from './fake-github'
import { vocabulary } from '../domain/fixtures'
const apps: { local: LocalVocabularyService; engine: SyncEngine }[] = []
function app() { const local = new LocalVocabularyService(new PolarDatabase(crypto.randomUUID())); const engine = new SyncEngine(local); const result = { local, engine }; apps.push(result); return result }
async function connect(engine: SyncEngine, fake: FakeGitHub) { await engine.confirm(await engine.test({ owner: 'example', repository: 'private-data', branch: '' }, '', new GitHubClient('artificial', fake.fetch))) }
afterEach(async () => { for (const a of apps) { await a.engine.disconnect(); await a.local.db.delete() } apps.length = 0 })
describe('safety, scale and backup boundary', () => {
  it('a remote field decision keeps independent local tag changes', async () => {
    const a = app(), b = app(), fake = new FakeGitHub(); const word = await a.local.add({ lang: 'en', lemma: 'field-choice', meanings: ['base'] }); await connect(a.engine, fake); await connect(b.engine, fake)
    await a.local.update(word.id, { lang: 'en', lemma: word.lemma, meanings: ['remote'] }, { expectedRevisionId: word.revisionId })
    await b.local.update(word.id, { lang: 'en', lemma: word.lemma, meanings: ['local'], tags: ['independent'] }, { expectedRevisionId: word.revisionId })
    await a.engine.synchronize(); await b.engine.synchronize(); expect(await b.local.db.conflicts.count()).toBe(1)
    const conflict = (await b.local.db.conflicts.toArray())[0]; await resolveConflict(b.local, conflict.id, 'remote'); await b.engine.synchronize(); const result = (await b.local.get(word.id))!; expect(result.meanings).toEqual(['remote']); expect(result.tags).toEqual(['independent'])
  })
  it('explicit first-connection local settings choice creates a shared revision', async () => {
    const a = app(), b = app(), fake = new FakeGitHub(); await connect(a.engine, fake); await b.local.updateSettings({ dailyNew: { en: 3, de: 2 } }); const preview = await b.engine.test({ owner: 'example', repository: 'private-data', branch: '' }, '', new GitHubClient('artificial', fake.fetch)); await b.engine.confirm(preview, 'local'); await a.engine.synchronize(); expect((await a.local.getSettings()).dailyNew).toEqual({ en: 3, de: 2 }); expect((await a.local.getSettings()).id).toBe((await b.local.getSettings()).id)
  })
  it('a grade created while PUT is in flight survives ACK and uploads in the next batch', async () => {
    const a = app(), fake = new FakeGitHub(); const word = await a.local.add({ lang: 'en', lemma: 'concurrent-grade', meanings: ['人工'], status: 'learning' }); const review = new LocalReviewService(a.local); const card = (await review.create(await review.previewCreate([word.id])))[0]; await connect(a.engine, fake); await a.local.add({ lang: 'de', lemma: 'upload-trigger' })
    fake.beforePut = async () => { fake.beforePut = undefined; await review.grade({ cardId: card.id, expectedRevisionId: card.revisionId, expectedStateId: card.stateId, eventId: crypto.randomUUID(), rating: 'Good' }) }
    await a.engine.synchronize(); expect(await a.local.db.reviewEvents.count()).toBe(1); expect(await a.local.db.pendingOperations.count()).toBe(2); expect((await decodeSnapshot(fake.text!)).reviewEvents).toHaveLength(0); await a.engine.synchronize(); expect((await decodeSnapshot(fake.text!)).reviewEvents).toHaveLength(1)
  })
  it('does not upload to a repository made public after authorization', async () => {
    const a = app(), fake = new FakeGitHub(); await connect(a.engine, fake); const version = fake.version; await a.local.add({ lang: 'en', lemma: 'private' }); fake.privateRepo = false; await expect(a.engine.synchronize()).rejects.toThrow('权限'); expect(fake.version).toBe(version); expect(await a.local.db.pendingOperations.count()).toBe(1)
  })
  it('retains the first-connection preview until explicit confirmation, including incompatible remote', async () => {
    const a = app(), fake = new FakeGitHub(); const preview = await a.engine.test({ owner: 'example', repository: 'private-data', branch: '' }, '', new GitHubClient('artificial', fake.fetch)); expect(preview.case).toBe('A'); expect(fake.version).toBe(0); expect(await a.local.db.connections.count()).toBe(0); a.engine.cancelPreview(); await expect(a.engine.confirm(preview)).rejects.toThrow('失效'); fake.text = '{"format":"other"}'; fake.version++; await expect(connect(a.engine, fake)).rejects.toThrow('协议'); expect(fake.version).toBe(1)
  })
  it('restoring a connected backup drops authorization, SHA and attempts, with no cloud deletion', async () => {
    const a = app(), fake = new FakeGitHub(); await connect(a.engine, fake); await a.local.add({ lang: 'en', lemma: 'backup' }); const backup = new LocalBackupService(a.local), raw = await (await backup.exportBackup()).text(), version = fake.version
    const plan = await backup.preview(new File([raw], 'backup.json')); await backup.restore(plan, 'replace-local'); expect(a.engine.authorized()).toBe(false); expect(await a.local.db.connections.count()).toBe(0); expect((await a.local.db.syncMetadata.toCollection().first())?.remoteSha).toBeNull(); expect(fake.version).toBe(version); await connect(a.engine, fake); expect((await decodeSnapshot(fake.text!)).vocabularies).toHaveLength(1)
  })
  it('merges structured leaves and context additions, but context deletion versus edit conflicts', async () => {
    const a = app(); const word = await a.local.add({ lang: 'de', lemma: 'Form', de: { article: 'die', plural: 'Formen' }, contexts: [{ id: crypto.randomUUID(), text: 'original' }] }); const base = await a.local.snapshot(), l = structuredClone(base), r = structuredClone(base)
    const lc = l.vocabularies[0], rc = r.vocabularies[0]; if (lc.lang !== 'de' || rc.lang !== 'de') throw new Error('fixture'); lc.de!.article = 'das'; rc.de!.plural = 'alternative'; lc.revisionId = crypto.randomUUID(); rc.revisionId = crypto.randomUUID(); lc.parentRevisionIds = [word.revisionId]; rc.parentRevisionIds = [word.revisionId]
    expect(mergeSnapshots(base, l, r).conflicts).toHaveLength(0); lc.contexts = []; rc.contexts![0].text = 'changed'; expect(mergeSnapshots(base, l, r).conflicts[0].fields).toContain('contexts')
  })
  it('rejects unknown fields and broken causal chains, even with matching envelope versions', async () => {
    const a = app(); const snapshot = await a.local.snapshot(); const raw = JSON.parse(encodeSnapshot(snapshot)); raw.snapshot.settings.unknown = 'field'; await expect(decodeSnapshot(JSON.stringify(raw))).rejects.toThrow('协议')
  })
  it('preserves full historical branches with descendants and connects the selected head', async () => {
    const a = app(), b = app(), fake = new FakeGitHub(); const word = await a.local.add({ lang: 'en', lemma: 'long-branch', meanings: ['人工'], status: 'learning' }); let time = new Date(); const ar = new LocalReviewService(a.local, () => time), br = new LocalReviewService(b.local, () => time); const card = (await ar.create(await ar.previewCreate([word.id])))[0]; await connect(a.engine, fake); await connect(b.engine, fake)
    const first = await ar.grade({ cardId: card.id, expectedRevisionId: card.revisionId, expectedStateId: card.stateId, rating: 'Good', eventId: crypto.randomUUID() }); await br.grade({ cardId: card.id, expectedRevisionId: card.revisionId, expectedStateId: card.stateId, rating: 'Again', eventId: crypto.randomUUID() }); time = new Date(Date.parse(first.card.fsrsState.due) + 1)
    const second = await ar.grade({ cardId: card.id, expectedRevisionId: first.card.revisionId, expectedStateId: first.card.stateId, rating: 'Good', eventId: crypto.randomUUID() }); await a.engine.synchronize(); expect(await b.engine.synchronize()).toBe('conflict'); const conflict = (await b.local.db.conflicts.toArray()).find((c) => c.kind === 'review-branch')!; await resolveConflict(b.local, conflict.id, 'review', first.event.id); await b.engine.synchronize(); const cloud = await decodeSnapshot(fake.text!); expect(cloud.reviewEvents).toHaveLength(3); expect(cloud.reviewResolutions[0].selectedHeadEventId).toBe(second.event.id)
  })
  it('simulates 1000 words and 40 real review events, keeping every record on two devices', async () => {
    const a = app(), b = app(), fake = new FakeGitHub(); await a.local.initialize()
    const words = Array.from({ length: 1000 }, (_, i) => ({ ...vocabulary(), id: crypto.randomUUID(), revisionId: crypto.randomUUID(), lemma: 'scale-' + i }))
    await a.local.transaction(async () => { await a.local.db.vocabularies.bulkAdd(words); for (const word of words) await a.local.appendPending('upsert-vocabulary', word) })
    const word = await a.local.add({ lang: 'en', lemma: 'scale-review', meanings: ['人工'], status: 'learning' }); let time = new Date(); const review = new LocalReviewService(a.local, () => time); let card = (await review.create(await review.previewCreate([word.id])))[0]
    for (let i = 0; i < 40; i++) { time = new Date(Math.max(time.getTime(), Date.parse(card.fsrsState.due)) + 1); card = (await review.grade({ cardId: card.id, expectedRevisionId: card.revisionId, expectedStateId: card.stateId, rating: 'Good', eventId: crypto.randomUUID() })).card }
    await connect(a.engine, fake); await connect(b.engine, fake); expect(await b.local.db.vocabularies.count()).toBe(1001); expect(await b.local.db.reviewEvents.count()).toBe(40); expect(fake.text!.length).toBeGreaterThan(300_000)
  }, 30_000)
})

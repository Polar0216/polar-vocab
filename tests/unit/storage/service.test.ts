import 'fake-indexeddb/auto'
import Dexie, { liveQuery } from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalVocabularyService } from '../../../src/features/vocabulary/service'
import { PolarDatabase, V1_STORES } from '../../../src/storage/database'
import { entryFromCapture } from '../../../src/storage/capture'
import { dataSnapshotSchema, type CaptureEvent, type VocabularyEntry } from '../../../src/domain'
import type { ImportPreview } from '../../../src/features/import-export/contracts'
import { capture, card, id, now, review, vocabulary } from '../domain/fixtures'

const databases: PolarDatabase[] = []
function service(name = `storage-test-${crypto.randomUUID()}`): LocalVocabularyService {
  const db = new PolarDatabase(name)
  databases.push(db)
  return new LocalVocabularyService(db)
}
afterEach(async () => { for (const db of databases) await db.delete(); databases.length = 0 })

function preview(words: string[], createdAt?: string): ImportPreview {
  return {
    batchId: id(200), mode: 'merge-vocabulary', format: 'csv', totalRows: words.length, validRows: words.length, invalidRows: 0, duplicateRows: 0,
    columns: ['word'], mapping: { word: 'word' }, issues: [],
    rows: words.map((lemma, index) => ({ rowId: id(201 + index), rowNumber: index + 2, payload: { lang: 'en', lemma }, capturedAt: now, origin: 'ios-csv', possibleDuplicateIds: [], ...(createdAt ? { createdAt } : {}) })),
  }
}

describe('Dexie v2 initialization and migration', () => {
  it('initializes singleton defaults once across concurrent service calls and seeds no vocabulary', async () => {
    const app = service()
    await Promise.all([app.initialize(), app.initialize(), new LocalVocabularyService(app.db).initialize()])
    expect(app.db.verno).toBe(3)
    expect(await app.db.settings.count()).toBe(1)
    expect(await app.db.syncMetadata.count()).toBe(1)
    expect(await app.db.devicePreferences.count()).toBe(1)
    expect(await app.db.vocabularies.count()).toBe(0)
    expect(await app.db.cards.count()).toBe(0)
    expect(await app.db.pendingOperations.count()).toBe(1)
    expect(await app.getDefaultLanguage()).toBe('en')
  })

  it('upgrades a populated v1 database in place without changing existing records', async () => {
    const name = `migration-${crypto.randomUUID()}`
    const legacy = new Dexie(name)
    legacy.version(1).stores(V1_STORES)
    await legacy.table('vocabularies').add(vocabulary())
    legacy.close()
    const app = service(name)
    await app.initialize()
    expect(app.db.verno).toBe(3)
    expect(await app.get(vocabulary().id)).toEqual(vocabulary())
    expect(await app.db.devicePreferences.count()).toBe(1)
    expect(await app.db.ingestedCaptures.count()).toBe(0)
  })

  it('refuses unknown record schemas before initializing and preserves the original rows', async () => {
    const app = service()
    const future = { ...vocabulary(), schemaVersion: 2 } as unknown as VocabularyEntry
    await app.db.vocabularies.add(future)
    await expect(app.initialize()).rejects.toMatchObject({ code: 'incompatible-schema' })
    expect(await app.db.vocabularies.get(future.id)).toEqual(future)
    expect(await app.db.settings.count()).toBe(0)
    expect(await app.db.pendingOperations.count()).toBe(0)
  })

  it.each(['orphan-card', 'missing-capture', 'missing-tombstone'] as const)('rejects %s integrity failures and rolls back newly initialized defaults', async (fault) => {
    const app = service()
    if (fault === 'orphan-card') await app.db.cards.add(card())
    else if (fault === 'missing-capture') await app.db.ingestedCaptures.add({ id: id(30), schemaVersion: 1 })
    else await app.db.vocabularies.add({ ...vocabulary(), deletedAt: now })
    const before = await Promise.all(app.db.tables.map((table) => table.toArray()))
    await expect(app.initialize()).rejects.toMatchObject({ code: 'invalid-data' })
    expect(await Promise.all(app.db.tables.map((table) => table.toArray()))).toEqual(before)
    expect(await app.db.settings.count()).toBe(0)
    expect(await app.db.syncMetadata.count()).toBe(0)
    expect(await app.db.pendingOperations.count()).toBe(0)
  })

  it('reads initialized services inside liveQuery without opening a write transaction', async () => {
    const app = service()
    await app.initialize()
    const observed = await new Promise<unknown>((resolve, reject) => {
      const subscription = liveQuery(() => Promise.all([app.stats(), app.getSettings(), app.getDefaultLanguage()])).subscribe({
        next: (value) => { subscription.unsubscribe(); resolve(value) }, error: reject,
      })
    })
    expect(observed).toEqual([expect.objectContaining({ en: 0, de: 0, inbox: 0 }), expect.objectContaining({ theme: 'system' }), 'en'])
  })

  it('revalidates the entire store after explicit invalidation and preserves invalid data', async () => {
    const app = service()
    await app.initialize()
    await app.db.cards.add(card())
    app.invalidateInitialization()
    await expect(app.initialize()).rejects.toMatchObject({ code: 'invalid-data' })
    expect(await app.db.cards.count()).toBe(1)
    expect(await app.db.settings.count()).toBe(1)
  })

  it('checks complete references on writes even when initialization is already cached', async () => {
    const app = service()
    await app.initialize()
    await app.db.cards.add(card())
    const before = await app.db.pendingOperations.count()
    await expect(app.add({ lang: 'en', lemma: 'fresh' })).rejects.toMatchObject({ code: 'invalid-data' })
    expect(await app.db.vocabularies.count()).toBe(0)
    expect(await app.db.cards.toArray()).toEqual([card()])
    expect(await app.db.pendingOperations.count()).toBe(before)
  })

  it('checks future schemas on writes despite the successful initialization cache', async () => {
    const app = service()
    await app.initialize()
    await app.db.vocabularies.add({ ...vocabulary(), schemaVersion: 2 } as unknown as VocabularyEntry)
    await expect(app.add({ lang: 'en', lemma: 'fresh' })).rejects.toMatchObject({ code: 'incompatible-schema' })
    expect(await app.db.vocabularies.count()).toBe(1)
    expect(await app.db.pendingOperations.count()).toBe(1)
  })
})

describe('local vocabulary mutations and queries', () => {
  it('persists a minimal word and pending operation after closing and reopening the database', async () => {
    const app = service()
    const entry = await app.add({ lang: 'en', lemma: 'example', source: '人工来源示例' })
    expect(entry.status).toBe('inbox')
    expect(await app.db.cards.count()).toBe(0)
    expect((await app.db.pendingOperations.toArray()).find((operation) => operation.kind === 'upsert-vocabulary')?.payload).toEqual(entry)
    const name = app.db.name
    app.db.close()
    const reopened = service(name)
    expect(await reopened.get(entry.id)).toEqual(entry)
    expect(await reopened.db.pendingOperations.count()).toBe(2)
  })

  it('uses language, normalization and German article hints without silently merging records', async () => {
    const app = service()
    await app.add({ lang: 'en', lemma: 'Example' })
    await expect(app.add({ lang: 'en', lemma: ' example ' })).rejects.toMatchObject({ code: 'duplicate' })
    await app.add({ lang: 'de', lemma: 'example' })
    await app.add({ lang: 'de', lemma: 'Entscheidung', de: { article: 'die' } })
    expect(await app.findDuplicates({ lang: 'de', lemma: ' die Entscheidung ' })).toHaveLength(1)
    await app.add({ lang: 'en', lemma: 'example' }, { allowDuplicate: true })
    expect(await app.list()).toHaveLength(4)
  })

  it('compares the editing revision inside the write transaction and preserves identity fields', async () => {
    const app = service()
    const original = await app.add({ lang: 'en', lemma: 'example', meanings: ['初始释义'] })
    const changed = await app.update(original.id, { lang: 'en', lemma: 'example', meanings: ['更新释义'], status: 'learning' }, { expectedRevisionId: original.revisionId })
    expect(changed.parentRevisionIds).toEqual([original.revisionId])
    expect(changed.revisionId).not.toBe(original.revisionId)
    expect(changed.createdAt).toBe(original.createdAt)
    expect(changed.id).toBe(original.id)
    expect(changed.origin).toBe(original.origin)
    await expect(app.update(original.id, { lang: 'en', lemma: 'example', meanings: ['陈旧内容'] }, { expectedRevisionId: original.revisionId })).rejects.toMatchObject({ code: 'stale-revision' })
    expect(await app.get(original.id)).toEqual(changed)
    expect(await app.db.cards.count()).toBe(0)
  })

  it('rejects language and origin identity changes without modifying the record', async () => {
    const app = service()
    const original = await app.add({ lang: 'en', lemma: 'example' })
    await expect(app.update(original.id, { lang: 'de', lemma: 'example' }, { expectedRevisionId: original.revisionId })).rejects.toMatchObject({ code: 'identity-change' })
    await expect(app.update(original.id, { lang: 'en', lemma: 'example', origin: 'windows' }, { expectedRevisionId: original.revisionId })).rejects.toMatchObject({ code: 'identity-change' })
    expect(await app.get(original.id)).toEqual(original)
  })

  it('rolls back the business record when an outbox hook fails', async () => {
    const app = service()
    await app.initialize()
    const before = await app.db.pendingOperations.count()
    const fail = () => { throw new Error('artificial outbox failure') }
    app.db.pendingOperations.hook('creating', fail)
    await expect(app.add({ lang: 'en', lemma: 'example' })).rejects.toThrow('artificial outbox failure')
    app.db.pendingOperations.hook('creating').unsubscribe(fail)
    expect(await app.db.vocabularies.count()).toBe(0)
    expect(await app.db.pendingOperations.count()).toBe(before)
  })

  it('rolls back earlier batch updates and pending records when a later selected ID is missing', async () => {
    const app = service()
    const entry = await app.add({ lang: 'en', lemma: 'example' })
    const before = await app.db.pendingOperations.count()
    await expect(app.batchUpdate([entry.id, id(999)], { status: 'archived', addTags: ['人工标签'] })).rejects.toMatchObject({ code: 'not-found' })
    expect(await app.get(entry.id)).toEqual(entry)
    expect(await app.db.pendingOperations.count()).toBe(before)
  })

  it('rejects invalid payloads and rolls back an invalid batch tag', async () => {
    const app = service()
    await expect(app.add({ lang: 'en', lemma: ' ' })).rejects.toMatchObject({ code: 'invalid-data' })
    const entry = await app.add({ lang: 'en', lemma: 'example' })
    const before = await app.db.pendingOperations.count()
    await expect(app.batchUpdate([entry.id], { addTags: ['   '] })).rejects.toMatchObject({ code: 'invalid-data' })
    expect(await app.get(entry.id)).toEqual(entry)
    expect(await app.db.pendingOperations.count()).toBe(before)
  })

  it('filters and searches word, meaning and context, and returns honest vocabulary statistics', async () => {
    const app = service()
    const english = await app.add({ lang: 'en', lemma: 'zebra', meanings: ['人工含义'], tags: ['animals'], contexts: [{ id: id(60), text: 'A synthetic context.' }] }, { createdAt: '2026-10-12T00:00:00Z' })
    const german = await app.add({ lang: 'de', lemma: 'Beispiel', status: 'learning' })
    expect(await app.list({ language: 'en', tag: 'animals', status: 'inbox' })).toEqual([english])
    expect(await app.list({ search: '人工含义' })).toEqual([english])
    expect(await app.list({ search: 'synthetic' })).toEqual([english])
    expect((await app.list({ sort: 'lemma-asc' })).map((entry) => entry.id)).toEqual([german.id, english.id])
    expect(await app.stats()).toMatchObject({ en: 1, de: 1, inbox: 1, pendingCount: 3 })
  })

  it('persists device language locally and settings with their own revision and outbox', async () => {
    const app = service()
    const settings = await app.getSettings()
    const pendingBefore = await app.db.pendingOperations.count()
    await app.setDefaultLanguage('de')
    expect(await app.getDefaultLanguage()).toBe('de')
    expect(await app.db.pendingOperations.count()).toBe(pendingBefore)
    expect(await app.getSettings()).toEqual(settings)
    const changed = await app.updateSettings({ theme: 'dark', dailyNew: { en: 8, de: 3 } })
    expect(changed.id).toBe(settings.id)
    expect(changed.parentRevisionIds).toEqual([settings.revisionId])
    expect(await app.db.pendingOperations.count()).toBe(pendingBefore + 1)
    app.db.close()
    const reopened = service(app.db.name)
    expect(await reopened.getDefaultLanguage()).toBe('de')
    expect((await reopened.getSettings()).theme).toBe('dark')
  })
})

describe('soft deletion and existing history', () => {
  it('never returns a tombstoned ID as active when its text was incorrectly made active externally', async () => {
    const app = service()
    const entry = await app.add({ lang: 'en', lemma: 'example' })
    await app.softDelete([entry.id])
    await app.db.vocabularies.put(entry)
    expect(await app.get(entry.id)).toBeUndefined()
    await expect(app.snapshot()).rejects.toMatchObject({ code: 'invalid-data' })
  })
  it('never resurrects a deleted ID and repeated deletion creates no duplicate tombstones', async () => {
    const app = service()
    const entry = await app.add({ lang: 'en', lemma: 'example' })
    await app.softDelete([entry.id])
    expect(await app.get(entry.id)).toBeUndefined()
    expect(await app.list()).toEqual([])
    const deleted = await app.db.vocabularies.get(entry.id)
    expect(deleted?.deletedAt).toBeTruthy()
    const pendingBefore = await app.db.pendingOperations.count()
    await expect(app.update(entry.id, { lang: 'en', lemma: 'example' }, { expectedRevisionId: deleted!.revisionId })).rejects.toMatchObject({ code: 'deleted' })
    await app.softDelete([entry.id])
    expect(await app.db.tombstones.count()).toBe(1)
    expect(await app.db.pendingOperations.count()).toBe(pendingBefore)
    expect(dataSnapshotSchema.safeParse(await app.snapshot()).success).toBe(true)
  })

  it('deletes existing cards in the same transaction, preserves FSRS state and every review event', async () => {
    const app = service()
    await app.initialize()
    await app.db.vocabularies.add(vocabulary())
    await app.db.cards.add(card())
    await app.db.reviewEvents.add(review())
    await app.softDelete([vocabulary().id])
    const deletedCard = await app.db.cards.get(card().id)
    expect(deletedCard?.suspended).toBe(true)
    expect(deletedCard?.deletedAt).toBeTruthy()
    expect(deletedCard?.fsrsState).toEqual(card().fsrsState)
    expect(await app.db.reviewEvents.toArray()).toEqual([review()])
    expect((await app.db.tombstones.toArray()).map((record) => record.entityType).sort()).toEqual(['card', 'vocabulary'])
    expect(dataSnapshotSchema.safeParse(await app.snapshot()).success).toBe(true)
  })
})

describe('deterministic capture ingestion', () => {
  it('uses fixed UUID v5 vectors and the same full initial record on two different devices', async () => {
    const entry = entryFromCapture(capture())
    expect(entry.id).toBe('98ae6197-677d-57b2-92af-6f9f4f3c438e')
    expect(entry.revisionId).toBe('1d394327-cc9c-51f0-89f3-a92018d9c4b6')
    expect(entry.createdAt).toBe(capture().capturedAt)
    expect(entry.updatedAt).toBe(capture().capturedAt)
    const first = service()
    const second = service()
    expect(await first.ingest([capture()])).toMatchObject({ status: 'saved', vocabularyIds: [entry.id] })
    expect(await second.ingest([capture()])).toMatchObject({ status: 'saved', vocabularyIds: [entry.id] })
    expect(await first.get(entry.id)).toEqual(await second.get(entry.id))
    expect(await first.getDeviceId()).not.toBe(await second.getDeviceId())
  })

  it('skips a retried event after its vocabulary was edited and preserves the revision', async () => {
    const app = service()
    await app.ingest([capture()])
    const entry = entryFromCapture(capture())
    const edited = await app.update(entry.id, { lang: 'de', lemma: 'Beispiel', meanings: ['人工释义'] }, { expectedRevisionId: entry.revisionId })
    expect(await app.ingest([capture()])).toEqual({ status: 'saved', vocabularyIds: [], skippedCaptureIds: [capture().id] })
    expect(await app.get(entry.id)).toEqual(edited)
    expect(await app.db.captures.count()).toBe(1)
    expect(await app.db.ingestedCaptures.count()).toBe(1)
  })

  it('rejects same event ID with different payload and rolls back the whole new batch', async () => {
    const app = service()
    await app.ingest([capture()])
    const pendingBefore = await app.db.pendingOperations.count()
    const fresh = { ...capture(), id: id(31), payload: { lang: 'en' as const, lemma: 'fresh' } }
    const collision = { ...capture(), payload: { lang: 'en' as const, lemma: 'changed' } }
    expect(await app.ingest([fresh, collision])).toEqual({ status: 'conflict', captureId: capture().id, reason: 'immutable-id' })
    expect(await app.db.captures.count()).toBe(1)
    expect(await app.db.ingestedCaptures.count()).toBe(1)
    expect(await app.db.vocabularies.count()).toBe(1)
    expect(await app.db.pendingOperations.count()).toBe(pendingBefore)
  })

  it('rolls back capture, entry, receipt and outbox if storage fails', async () => {
    const app = service()
    await app.initialize()
    const pendingBefore = await app.db.pendingOperations.count()
    const fail = () => { throw new Error('artificial capture failure') }
    app.db.ingestedCaptures.hook('creating', fail)
    expect(await app.ingest([capture()])).toEqual({ status: 'failed', reason: 'storage' })
    app.db.ingestedCaptures.hook('creating').unsubscribe(fail)
    expect(await app.db.captures.count()).toBe(0)
    expect(await app.db.ingestedCaptures.count()).toBe(0)
    expect(await app.db.vocabularies.count()).toBe(0)
    expect(await app.db.pendingOperations.count()).toBe(pendingBefore)
  })

  it('rejects invalid and future capture versions without writing business data', async () => {
    const app = service()
    expect(await app.ingest([{ ...capture(), schemaVersion: 2 } as unknown as CaptureEvent])).toEqual({ status: 'failed', reason: 'incompatible-schema' })
    expect(await app.ingest([{ ...capture(), payload: { lang: 'de', lemma: '' } }])).toEqual({ status: 'failed', reason: 'invalid-data' })
    expect(await app.db.captures.count()).toBe(0)
  })
})

describe('import commit atomicity and conservative duplicate handling', () => {
  it('is idempotent on repeated confirmation and stores original row time, event and receipt', async () => {
    const app = service()
    const data = preview(['example', 'second'], '2026-10-12T00:00:00Z')
    expect(await app.commitImport(data, {})).toEqual({ added: 2, updated: 0, skipped: 0 })
    expect(await app.commitImport(data, {})).toEqual({ added: 0, updated: 0, skipped: 2 })
    expect(await app.db.vocabularies.count()).toBe(2)
    expect(await app.db.captures.count()).toBe(2)
    expect(await app.db.ingestedCaptures.count()).toBe(2)
    expect((await app.list()).every((entry) => entry.createdAt === '2026-10-12T00:00:00Z')).toBe(true)
    expect(dataSnapshotSchema.safeParse(await app.snapshot()).success).toBe(true)
  })

  it('rechecks duplicates created after preview, including an earlier row in the same batch', async () => {
    const app = service()
    const data = preview(['example', 'EXAMPLE', 'second'])
    await app.add({ lang: 'en', lemma: 'example' })
    expect(await app.commitImport(data, {})).toEqual({ added: 1, updated: 0, skipped: 2 })
    const second = service()
    expect(await second.commitImport(preview(['same', 'SAME']), {})).toEqual({ added: 1, updated: 0, skipped: 1 })
  })

  it('supplements absent fields and never replaces existing meanings or context arrays', async () => {
    const app = service()
    const existing = await app.add({ lang: 'en', lemma: 'example', meanings: ['用户已有释义'], contexts: [{ id: id(60), text: 'Original artificial context.' }] })
    const data = preview(['example'])
    const supplemented = { ...data, rows: [{ ...data.rows[0], payload: { lang: 'en' as const, lemma: 'example', meanings: ['文件释义'], source: '导入来源', tags: ['人工标签'], contexts: [{ id: id(61), text: 'Imported artificial context.' }] } }] }
    expect(await app.commitImport(supplemented, { [data.rows[0].rowId]: 'fill-empty-fields' })).toEqual({ added: 0, updated: 1, skipped: 0 })
    expect(await app.get(existing.id)).toMatchObject({ meanings: existing.meanings, contexts: existing.contexts, source: '导入来源', tags: ['人工标签'], parentRevisionIds: [existing.revisionId] })
  })

  it('rolls back every row when an outbox hook fails during the second row', async () => {
    const app = service()
    await app.initialize()
    const pendingBefore = await app.db.pendingOperations.count()
    let calls = 0
    const failSecond = () => { calls += 1; if (calls === 3) throw new Error('artificial second-row failure') }
    app.db.pendingOperations.hook('creating', failSecond)
    await expect(app.commitImport(preview(['example', 'second']), {})).rejects.toThrow('artificial second-row failure')
    app.db.pendingOperations.hook('creating').unsubscribe(failSecond)
    expect(await app.db.vocabularies.count()).toBe(0)
    expect(await app.db.captures.count()).toBe(0)
    expect(await app.db.ingestedCaptures.count()).toBe(0)
    expect(await app.db.pendingOperations.count()).toBe(pendingBefore)
  })

  it('preserves clipboard origin and rejects a stale mutated preview after successful ingestion', async () => {
    const app = service()
    const data = { ...preview(['example']), format: 'txt' as const, rows: preview(['example']).rows.map((row) => ({ ...row, origin: 'clipboard' as const })) }
    await app.commitImport(data, {})
    expect((await app.list())[0].origin).toBe('clipboard')
    const changed = { ...data, rows: data.rows.map((row) => ({ ...row, payload: { lang: 'en' as const, lemma: 'changed' } })) }
    await expect(app.commitImport(changed, {})).rejects.toMatchObject({ code: 'immutable-id' })
    expect((await app.list())[0].lemma).toBe('example')
  })
})

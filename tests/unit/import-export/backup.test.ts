import 'fake-indexeddb/auto'
import { liveQuery } from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalBackupService, localBackupSchema } from '../../../src/features/import-export/backup-service'
import { LocalVocabularyService } from '../../../src/features/vocabulary/service'
import { PolarDatabase } from '../../../src/storage/database'
import { canonicalJson } from '../../../src/storage/capture'
import { capture, card, review, settings, vocabulary } from '../domain/fixtures'

let db: PolarDatabase
let service: LocalVocabularyService
let backup: LocalBackupService
async function text(blob: Blob): Promise<string> {
  if (blob.text) return blob.text()
  return new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob) })
}
async function file(blob: Blob): Promise<File> { return new File([await text(blob)], 'backup.json', { type: 'application/json' }) }
beforeEach(async () => {
  db = new PolarDatabase(`backup-test-${crypto.randomUUID()}`)
  service = new LocalVocabularyService(db); backup = new LocalBackupService(service)
  await service.initialize()
})
afterEach(async () => { await db.delete() })

describe('complete local backup and guarded atomic restore', () => {
  it('rejects future or unknown receipt fields before export and clear without dropping them', async () => {
    await service.ingest([capture()])
    const original = await db.ingestedCaptures.get(capture().id)
    for (const invalid of [{ ...original, schemaVersion: 2 }, { ...original, extra: 'future-field' }]) {
      await db.table('ingestedCaptures').put(invalid)
      await expect(backup.exportBackup()).rejects.toThrow()
      await expect(backup.prepareClear()).rejects.toThrow()
      expect(await db.table('ingestedCaptures').get(capture().id)).toEqual(invalid)
      expect(await db.vocabularies.count()).toBe(1)
    }
  })

  it('preserves source, optional German fields, settings, capture receipts and pending without credentials', async () => {
    await service.add({ lang: 'de', lemma: 'Entscheidung', source: '公开测试来源', de: { article: 'die', plural: 'Entscheidungen' } })
    await service.setDefaultLanguage('de')
    await service.updateSettings({ theme: 'dark' })
    await service.ingest([capture()])
    const original = localBackupSchema.parse(JSON.parse(await text(await backup.exportBackup())))
    expect(original.backupVersion).toBe(2)
    expect(original.snapshot.cards).toEqual([])
    expect(original.snapshot.ingestedCaptureIds).toEqual([capture().id])
    expect(original.local.pendingOperations.length).toBeGreaterThan(0)
    expect(original.snapshot.settings.theme).toBe('dark')
    expect(JSON.stringify(original)).not.toMatch(/"(?:token|Authorization)"/)
    const preview = await backup.preview(await file(await backup.exportBackup()))
    await backup.restore(preview, 'replace-local')
    expect((await service.list()).map((entry) => entry.lemma).sort()).toEqual(['Beispiel', 'Entscheidung'])
    expect(await service.getDefaultLanguage()).toBe('de')
    const restored = localBackupSchema.parse(JSON.parse(await text(await backup.exportBackup())))
    expect(restored.snapshot.vocabularies).toEqual(original.snapshot.vocabularies)
    expect(restored.local.pendingOperations).toEqual(original.local.pendingOperations)
    expect(restored.snapshot.ingestedCaptureIds).toEqual(original.snapshot.ingestedCaptureIds)
    expect(restored.local.syncMetadata[0].remoteSha).toBeNull()
    expect(restored.local.syncMetadata[0].status).toBe('unconfigured')
  })

  it('round-trips existing review audit and deletion evidence without rewriting FSRS', async () => {
    await db.settings.clear(); await db.settings.add(settings())
    await db.vocabularies.add(vocabulary()); await db.cards.add(card()); await db.reviewEvents.add(review())
    await service.softDelete([vocabulary().id])
    const source = await backup.exportBackup()
    const preview = await backup.preview(await file(source))
    expect(preview.counts.tombstones).toBe(2)
    await backup.restore(preview, 'replace-local')
    expect(await service.list()).toEqual([])
    expect(await db.reviewEvents.get(review().id)).toEqual(review())
    expect((await db.cards.get(card().id))?.deletedAt).toBeTruthy()
    expect(await db.tombstones.count()).toBe(2)
    const duplicate = await backup.preview(await file(source))
    await backup.restore(duplicate, 'replace-local')
    expect(await db.vocabularies.count()).toBe(1)
    expect(await db.reviewEvents.count()).toBe(1)
  })

  it.each(['schemaVersion', 'backupVersion'])('rejects unknown %s and leaves original data intact', async (field) => {
    await service.add({ lang: 'en', lemma: 'unchanged' })
    const content = JSON.parse(await text(await backup.exportBackup()))
    content[field] = 99
    await expect(backup.preview(new File([JSON.stringify(content)], 'future.json'))).rejects.toMatchObject({ code: 'version' })
    expect((await service.list())[0].lemma).toBe('unchanged')
  })

  it('rejects malformed JSON, unknown fields, credentials and invalid references before writes', async () => {
    await expect(backup.preview(new File(['{'], 'broken.json'))).rejects.toMatchObject({ code: 'format' })
    const raw = JSON.parse(await text(await backup.exportBackup()))
    raw.local.token = 'artificial forbidden field'
    await expect(backup.preview(new File([JSON.stringify(raw)], 'secret-field.json'))).rejects.toMatchObject({ code: 'invalid-data' })
    delete raw.local.token
    raw.snapshot.cards = [card()]
    await expect(backup.preview(new File([JSON.stringify(raw)], 'invalid-reference.json'))).rejects.toMatchObject({ code: 'invalid-data' })
    expect(await db.vocabularies.count()).toBe(0)
  })

  it('previews without writing, refuses merge mode and does not trust mutated preview content', async () => {
    await service.add({ lang: 'en', lemma: 'preview' })
    const before = await db.vocabularies.toArray()
    const preview = await backup.preview(await file(await backup.exportBackup()))
    expect(await db.vocabularies.toArray()).toEqual(before)
    await expect(backup.restore(preview, 'merge-current')).rejects.toMatchObject({ code: 'unsupported-mode' })
    preview.snapshot.vocabularies[0].lemma = 'tampered'
    await backup.restore(preview, 'replace-local')
    expect((await service.list())[0].lemma).toBe('preview')
  })

  it('detects changes after preview, including pending/settings and another page write', async () => {
    const source = await backup.exportBackup()
    const preview = await backup.preview(await file(source))
    await service.add({ lang: 'en', lemma: 'later' })
    await expect(backup.restore(preview, 'replace-local')).rejects.toMatchObject({ code: 'stale-preview' })
    expect((await service.list())[0].lemma).toBe('later')
  })

  it('refuses old backups that would erase a permanent deletion', async () => {
    const entry = await service.add({ lang: 'en', lemma: 'deleted' })
    const old = await backup.exportBackup()
    await service.softDelete([entry.id])
    await expect(backup.preview(await file(old))).rejects.toMatchObject({ code: 'deletion-history' })
    expect(await service.list()).toEqual([])
    expect(await db.tombstones.count()).toBe(1)
  })

  it('refuses same capture UUID with different immutable payload', async () => {
    await service.ingest([capture()])
    const raw = JSON.parse(await text(await backup.exportBackup()))
    raw.snapshot.captures[0].payload.lemma = 'different'
    await expect(backup.preview(new File([JSON.stringify(raw)], 'collision.json'))).rejects.toMatchObject({ code: 'immutable-id' })
    expect((await db.captures.get(capture().id))?.payload.lemma).toBe('Beispiel')
  })

  it('rejects changed card identity and same outbox ID with different payload', async () => {
    await db.vocabularies.add(vocabulary()); await db.cards.add(card())
    const source = JSON.parse(await text(await backup.exportBackup()))
    source.snapshot.cards[0].template = 'reverse'
    await expect(backup.preview(new File([JSON.stringify(source)], 'wrong-card.json'))).rejects.toMatchObject({ code: 'immutable-id' })
    source.snapshot.cards[0].template = 'meaning'
    source.local.pendingOperations[0].payload.theme = 'dark'
    await expect(backup.preview(new File([JSON.stringify(source)], 'wrong-outbox.json'))).rejects.toMatchObject({ code: 'immutable-id' })
    expect((await db.cards.get(card().id))?.template).toBe('meaning')
  })

  it('rolls back all overwritten tables if restore fails midway', async () => {
    await service.add({ lang: 'en', lemma: 'keep' })
    const before = canonicalJson(await db.vocabularies.toArray())
    const preview = await backup.preview(await file(await backup.exportBackup()))
    const fail = () => { throw new Error('Injected IndexedDB failure') }
    db.pendingOperations.hook('creating', fail)
    await expect(backup.restore(preview, 'replace-local')).rejects.toThrow('Injected IndexedDB failure')
    db.pendingOperations.hook('creating').unsubscribe(fail)
    expect(canonicalJson(await db.vocabularies.toArray())).toBe(before)
    expect(await db.pendingOperations.count()).toBeGreaterThan(0)
  })

  it('guards clear, returns the complete pre-clear backup and resets the local profile atomically', async () => {
    await service.add({ lang: 'en', lemma: 'clear me' })
    const preview = await backup.prepareClear()
    expect(JSON.parse(await text(preview.preClearBackup)).snapshot.vocabularies).toHaveLength(1)
    const result = await backup.clearLocal(preview)
    expect(result.preClearBackup).toBe(preview.preClearBackup)
    expect(await service.list()).toEqual([])
    expect(await db.captures.count()).toBe(0)
    expect(await db.tombstones.count()).toBe(0)
    expect((await service.getSettings()).theme).toBe('system')
  })

  it('clear aborts if the profile changed after confirmation or defaults cannot persist', async () => {
    const entry = await service.add({ lang: 'en', lemma: 'safe' })
    const old = await backup.prepareClear()
    await service.updateSettings({ theme: 'dark' })
    await expect(backup.clearLocal(old)).rejects.toMatchObject({ code: 'stale-preview' })
    const current = await backup.prepareClear()
    const fail = () => { throw new Error('Cannot save defaults') }
    db.settings.hook('creating', fail)
    await expect(backup.clearLocal(current)).rejects.toThrow('Cannot save defaults')
    // The first read after failure must be safe in the UI's read-only liveQuery.
    const observed = await new Promise<unknown>((resolve, reject) => {
      const subscription = liveQuery(() => Promise.all([service.list(), service.getSettings()])).subscribe({
        next: (value) => { subscription.unsubscribe(); resolve(value) }, error: reject,
      })
    })
    expect(observed).toEqual([expect.arrayContaining([expect.objectContaining({ lemma: 'safe' })]), expect.objectContaining({ theme: 'dark' })])
    db.settings.hook('creating').unsubscribe(fail)
    expect((await service.get(entry.id))?.lemma).toBe('safe')
    expect((await service.getSettings()).theme).toBe('dark')
  })
})

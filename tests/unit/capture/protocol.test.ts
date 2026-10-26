import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { batchPath, captureBatchSchema, decodeBatch, encodeBatch, entryFromCapture, type CaptureBatch } from '../../../packages/shared'
import { buildCapturePreview } from '../../../src/features/capture/receiver'
import { LocalVocabularyService } from '../../../src/features/vocabulary/service'
import { PolarDatabase } from '../../../src/storage/database'
import { GitHubClient } from '../../../src/integrations/github/client'
import { CaptureRepositoryError } from '../../../src/integrations/github/captures'
import { CaptureGitHubFake } from '../../mocks/capture-github'
import { capture, id, snapshot } from '../domain/fixtures'

const batch = (): CaptureBatch => ({ format: 'polar-vocab-capture-batch', protocolVersion: 1, schemaVersion: 1, id: id(901), deviceId: capture().deviceId, month: '2026-10', events: [capture()] })
const databases: PolarDatabase[] = []
afterEach(async () => { for (const db of databases) await db.delete(); databases.length = 0 })
async function remote(fake = new CaptureGitHubFake()) { const client = new GitHubClient('artificial-test-credential', fake.fetch); const target = await client.verify({ owner: 'capture-test', repository: 'data', branch: 'main', path: 'data/state.json' }); return { fake, repository: await client.captures(target) } }

describe('shared immutable capture protocol', () => {
  it('round-trips existing CaptureEvent without changing language, spelling, dates or UUIDv5 derivation', () => {
    const original = batch(), decoded = decodeBatch(encodeBatch(original), batchPath(original))
    expect(decoded.events[0]).toEqual(capture()); expect(entryFromCapture(decoded.events[0])).toEqual(entryFromCapture(capture()))
    expect(entryFromCapture(capture()).status).toBe('inbox')
  })
  it('rejects future versions, extra fields, mismatched month/device/origin, duplicate IDs and path spoofing', () => {
    const original = batch()
    for (const value of [{ ...original, protocolVersion: 3 }, { ...original, token: 'not-a-credential' }, { ...original, month: '2026-11' }, { ...original, deviceId: id(905) }, { ...original, events: [capture(), capture()] }, { ...original, events: [{ ...capture(), origin: 'web' }] }]) expect(captureBatchSchema.safeParse(value).success).toBe(false)
    expect(() => decodeBatch(encodeBatch(original), `captures/${id(999)}/2026-10/${original.id}.json`)).toThrow()
  })
  it('marks same-spelling vocabulary as a possible duplicate, without rewriting the event', () => {
    const data = snapshot(); data.vocabularies.push({ ...entryFromCapture(capture()), id: id(906) })
    const preview = buildCapturePreview([batch()], data)
    expect(preview[0].duplicateVocabularyIds).toContain(id(906)); expect(preview[0].event).toEqual(capture())
  })
  it('rejects an immutable ID collision before import', () => {
    const data = snapshot(); data.captures = [{ ...capture(), payload: { lang: 'en', lemma: 'different' } }]
    expect(() => buildCapturePreview([batch()], data)).toThrow('同一采集ID')
  })
  it('imports twice through the existing service, preserving edits, receipts, cards and reviews', async () => {
    const db = new PolarDatabase('phase4-capture-' + crypto.randomUUID()); databases.push(db)
    const service = new LocalVocabularyService(db); await service.initialize()
    const before = await service.snapshot(), event = capture()
    expect((await service.ingest([event])).status).toBe('saved')
    const entry = entryFromCapture(event)
    await service.update(entry.id, { ...event.payload, meanings: ['人工修改后保留'], status: 'inbox' }, { expectedRevisionId: entry.revisionId })
    const second = await service.ingest([event]); expect(second).toMatchObject({ status: 'saved', vocabularyIds: [], skippedCaptureIds: [event.id] })
    const after = await service.snapshot()
    expect(after.cards).toEqual(before.cards); expect(after.reviewEvents).toEqual(before.reviewEvents)
    expect(after.vocabularies).toHaveLength(1); expect(after.vocabularies[0].meanings).toEqual(['人工修改后保留'])
    expect(after.captures).toEqual([event]); expect(after.ingestedCaptureIds).toEqual([event.id])
    expect((await db.pendingOperations.toArray()).some((op) => op.kind === 'append-capture')).toBe(true)
  })
})
describe('capture-only GitHub capability (simulated)', () => {
  it('creates immutable files, enumerates tree blobs, downloads, and does not PUT state.json', async () => {
    const { fake, repository } = await remote(), original = batch()
    await repository.upload(original); await repository.upload(original)
    expect(fake.writes).toEqual([batchPath(original)])
    const files = await repository.scan(); expect(files).toHaveLength(1)
    expect(await repository.download(files[0])).toEqual(original)
    expect(fake.files.has('data/state.json')).toBe(false)
  })
  it('confirms a lost response from the same stable path without another PUT', async () => {
    const { fake, repository } = await remote(); fake.loseNextResponse = true
    await expect(repository.upload(batch())).rejects.toMatchObject({ code: 'network', uncertain: true })
    await expect(repository.upload(batch())).resolves.toMatch(/^[0-9a-f]{40}$/)
    expect(fake.writes).toHaveLength(1)
  })
  it('never overwrites another body at an existing path', async () => {
    const { fake, repository } = await remote(); await repository.upload(batch())
    const changed = { ...batch(), events: [{ ...capture(), payload: { lang: 'en' as const, lemma: 'changed' } }] }
    await expect(repository.upload(changed)).rejects.toBeInstanceOf(CaptureRepositoryError)
    expect(fake.writes).toHaveLength(1)
  })
  it('refuses a truncated tree or a renamed capture body', async () => {
    const { fake, repository } = await remote(); await repository.upload(batch()); fake.truncated = true
    await expect(repository.scan()).rejects.toMatchObject({ code: 'incomplete' })
    fake.truncated = false; const files = await repository.scan(); fake.files.set(files[0].path, { text: encodeBatch({ ...batch(), id: id(999) }), sha: files[0].sha })
    await expect(repository.download(files[0])).rejects.toMatchObject({ code: 'invalid' })
  })
  it('rechecks private access before uploading or reading batches', async () => {
    const { fake, repository } = await remote(); fake.publicRepository = true
    await expect(repository.upload(batch())).rejects.toMatchObject({ code: 'forbidden' }); expect(fake.writes).toHaveLength(0)
  })
})

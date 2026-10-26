import 'fake-indexeddb/auto'
import { afterEach, expect, it } from 'vitest'
import { batchPath, captureEventSchema, decodeBatch, editSense, emptyLexicon, encodeBatch, entryFromCapture, manualSense, senseMeanings, type CaptureBatch } from '../../../packages/shared'
import { LocalVocabularyService } from '../../../src/features/vocabulary/service'
import { PolarDatabase } from '../../../src/storage/database'
import { GitHubClient } from '../../../src/integrations/github/client'
import { buildCapturePreview } from '../../../src/features/capture/receiver'
import { decodeSnapshot, encodeSnapshot } from '../../../src/features/sync/protocol'
import { mergeSnapshots } from '../../../src/features/sync/merge'
import { CaptureGitHubFake } from '../../mocks/capture-github'
import { capture, id, snapshot } from '../domain/fixtures'

const databases: PolarDatabase[] = []
afterEach(async () => { for (const db of databases) await db.delete(); databases.length = 0 })
function sample() {
  const lexicon = { ...emptyLexicon(), senses: [editSense(manualSense(), 'chinese', '人工名词释义'), editSense(manualSense(), 'chinese', '人工动词释义')] }
  lexicon.senses[0].partOfSpeech = 'noun'; lexicon.senses[1].partOfSpeech = 'verb'
  return { ...capture(), payload: { ...capture().payload, lexicon, meanings: senseMeanings(lexicon) } }
}
it('keeps legacy JSON unchanged and rejects duplicate sense IDs and extension in a legacy envelope', () => {
  const old = capture(); expect(captureEventSchema.parse(old)).toEqual(old)
  const event = sample(), batch: CaptureBatch = { format: 'polar-vocab-capture-batch', protocolVersion: 2, schemaVersion: 1, id: id(950), deviceId: event.deviceId, month: '2026-10', events: [event] }
  expect(decodeBatch(encodeBatch(batch), batchPath(batch)).events[0]).toEqual(event)
  expect(() => encodeBatch({ ...batch, protocolVersion: 1 })).toThrow('协议2')
  expect(captureEventSchema.safeParse({ ...event, payload: { ...event.payload, lexicon: { ...event.payload.lexicon, senses: [event.payload.lexicon.senses[0], event.payload.lexicon.senses[0]] } } }).success).toBe(false)
  expect(entryFromCapture(event).id).toBe(entryFromCapture(old).id)
})
it('carries complete senses through the GitHub adapter (fake server), Web preview/import, edits, dedupe and JSON snapshot', async () => {
  const event = sample(), batch: CaptureBatch = { format: 'polar-vocab-capture-batch', protocolVersion: 2, schemaVersion: 1, id: id(951), deviceId: event.deviceId, month: '2026-10', events: [event] }
  const fake = new CaptureGitHubFake(), client = new GitHubClient('artificial-test-credential', fake.fetch)
  const target = await client.verify({ owner: 'capture-test', repository: 'data', branch: 'main', path: 'data/state.json' }), repository = await client.captures(target)
  await repository.upload(batch); await repository.upload(batch)
  expect(fake.writes).toEqual([batchPath(batch)])
  const downloaded = await repository.download((await repository.scan())[0])
  const db = new PolarDatabase('phase41-' + crypto.randomUUID()); databases.push(db)
  const service = new LocalVocabularyService(db); await service.initialize()
  const before = await service.snapshot(); expect(buildCapturePreview([downloaded], before)[0].event.payload.lexicon).toEqual(event.payload.lexicon)
  expect((await service.ingest(downloaded.events)).status).toBe('saved')
  const entry = entryFromCapture(event), edited = structuredClone(event.payload.lexicon)
  edited.senses[0] = editSense(edited.senses[0], 'chinese', '人工保存的修改')
  await service.update(entry.id, { ...event.payload, lexicon: edited, meanings: senseMeanings(edited), status: 'inbox' }, { expectedRevisionId: entry.revisionId })
  expect((await service.ingest([event]))).toMatchObject({ skippedCaptureIds: [event.id] })
  const after = await service.snapshot(), roundtrip = await decodeSnapshot(encodeSnapshot(after))
  expect(JSON.parse(encodeSnapshot(after)).protocolVersion).toBe(2)
  expect(roundtrip.vocabularies[0].lexicon).toEqual(edited)
  expect(roundtrip.captures[0]).toEqual(event)
  expect(roundtrip.cards).toEqual(before.cards); expect(roundtrip.reviewEvents).toEqual(before.reviewEvents)
  expect(() => decodeBatch(JSON.stringify({ ...batch, protocolVersion: 3 }))).toThrow()
  await expect(decodeSnapshot(JSON.stringify({ ...JSON.parse(encodeSnapshot(after)), protocolVersion: 1 }))).rejects.toThrow('不兼容')
  expect(JSON.parse(encodeSnapshot(before)).protocolVersion).toBe(1)
})
it('merges dictionary senses atomically and keeps the Chinese review projection consistent', () => {
  const base = snapshot(); base.vocabularies = [entryFromCapture(sample())]
  const local = structuredClone(base), remote = structuredClone(base)
  local.vocabularies[0].revisionId = id(960)
  local.vocabularies[0].lexicon!.senses[0].chinese = '本地人工修改'
  local.vocabularies[0].meanings = senseMeanings(local.vocabularies[0].lexicon!)
  remote.vocabularies[0].revisionId = id(961); remote.vocabularies[0].tags = ['远端标签']
  const merged = mergeSnapshots(base, local, remote)
  expect(merged.conflicts).toHaveLength(0)
  expect(merged.snapshot.vocabularies[0].meanings).toEqual(senseMeanings(merged.snapshot.vocabularies[0].lexicon!))
  expect(merged.snapshot.vocabularies[0].tags).toEqual(['远端标签'])
  remote.vocabularies[0].lexicon!.senses[1].chinese = '远端修改另一义项'
  remote.vocabularies[0].meanings = senseMeanings(remote.vocabularies[0].lexicon!)
  expect(mergeSnapshots(base, local, remote).conflicts.some(conflict => conflict.fields.includes('lexicon'))).toBe(true)
})

it('rejects a mismatched Chinese projection and prevents old editing or CSV supplementation from losing senses', async () => {
  const event = sample()
  expect(captureEventSchema.safeParse({ ...event, payload: { ...event.payload, meanings: ['不一致的平面释义'] } }).success).toBe(false)
  const db = new PolarDatabase('phase41-csv-' + crypto.randomUUID()); databases.push(db)
  const service = new LocalVocabularyService(db); await service.initialize(); await service.ingest([event])
  const entry = entryFromCapture(event)
  await expect(service.update(entry.id, { lang: entry.lang, lemma: entry.lemma }, { expectedRevisionId: entry.revisionId })).rejects.toThrow('义项编辑器')
  const rowId = id(970)
  await service.commitImport({ batchId: id(971), mode: 'merge-vocabulary', format: 'csv', totalRows: 1, validRows: 1, invalidRows: 0, duplicateRows: 1,
    columns: ['word'], mapping: { word: 'word' }, issues: [], rows: [{ rowId, rowNumber: 2, payload: { lang: event.payload.lang, lemma: event.payload.lemma, meanings: ['不替换结构化义项'], tags: ['CSV标签'] }, origin: 'ios-csv', capturedAt: event.capturedAt, possibleDuplicateIds: [entry.id] }],
  }, { [rowId]: 'fill-empty-fields' })
  expect((await service.get(entry.id))?.lexicon).toEqual(event.payload.lexicon)
  expect((await service.get(entry.id))?.tags).toEqual(['CSV标签'])
})

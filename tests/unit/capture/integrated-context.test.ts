import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { captureEventSchema, encodeBatch, decodeBatch, entryFromCapture, payloadRequiresProtocol2, type CaptureBatch, type CaptureEvent } from '../../../packages/shared'
import { LocalVocabularyService } from '../../../src/features/vocabulary/service'
import { PolarDatabase } from '../../../src/storage/database'
import { encodeSnapshot, decodeSnapshot } from '../../../src/features/sync/protocol'
import { mergeSnapshots } from '../../../src/features/sync/merge'
import { capture, id, snapshot } from '../domain/fixtures'

const dbs: PolarDatabase[] = []
afterEach(async () => { for (const db of dbs) await db.delete(); dbs.length = 0 })
const context = () => ({ id: id(1801), text: 'They persevered despite difficulties.', translation: '他们在困难中坚持下来。', translationLanguage: 'zh-CN' as const, translationSource: { provider: 'mymemory' as const } })
const event = (): CaptureEvent => ({ ...capture(), payload: { lang: 'en', lemma: 'persevere', encounteredForm: 'persevered', lemmaResolution: { lemma: 'persevere', tags: ['form-of', 'past'], source: { provider: 'wiktionary', url: 'https://en.wiktionary.org/wiki/persevered#English', license: 'CC-BY-SA-4.0' } }, contexts: [context()] } })
const batch = (value: CaptureEvent, protocolVersion: 1 | 2 = 2): CaptureBatch => ({ format: 'polar-vocab-capture-batch', schemaVersion: 1, protocolVersion, id: id(1802), deviceId: value.deviceId, month: '2026-10', events: [value] })

describe('encounter form and shared sentence protocol', () => {
  it('keeps legacy JSON byte structure and rejects ungrounded/mismatched saved resolutions', () => {
    expect(captureEventSchema.parse(capture())).toEqual(capture())
    const original = event(); expect(captureEventSchema.parse(original)).toEqual(original)
    expect(entryFromCapture(original).id).toBe(entryFromCapture(capture()).id)
    expect(captureEventSchema.safeParse({ ...original, payload: { ...original.payload, lemma: 'different' } }).success).toBe(false)
    expect(captureEventSchema.safeParse({ ...original, payload: { ...original.payload, encounteredForm: undefined } }).success).toBe(false)
    expect(captureEventSchema.safeParse({ ...original, payload: { lang: 'en', lemma: 'test', contexts: [{ id: id(1803), text: 'Test.', translation: '测试。' }] } }).success).toBe(false)
  })
  it('requires protocol2 for a surface or sentence translation even without any lexicon', async () => {
    const values: CaptureEvent[] = [
      { ...capture(), payload: { ...capture().payload, encounteredForm: 'Beispiele' } },
      { ...capture(), payload: { ...capture().payload, contexts: [context()] } }, event(),
    ]
    for (const value of values) {
      expect(payloadRequiresProtocol2(value.payload)).toBe(true)
      expect(() => encodeBatch(batch(value, 1))).toThrow('协议2')
      expect(decodeBatch(encodeBatch(batch(value))).events[0]).toEqual(value)
      const data = snapshot(); data.captures = [value]
      const encoded = encodeSnapshot(data); expect(JSON.parse(encoded).protocolVersion).toBe(2)
      expect((await decodeSnapshot(encoded)).captures).toEqual([value])
      await expect(decodeSnapshot(JSON.stringify({ ...JSON.parse(encoded), protocolVersion: 1 }))).rejects.toThrow('不兼容')
    }
    expect(payloadRequiresProtocol2(capture().payload)).toBe(false)
  })
  it('imports multiple words with the same context ID independently, retains receipts and survives repeat ingestion', async () => {
    const db = new PolarDatabase('integrated-context-' + crypto.randomUUID()); dbs.push(db)
    const service = new LocalVocabularyService(db); await service.initialize()
    const first = event(), second: CaptureEvent = { ...event(), id: id(1810), payload: { ...event().payload, lemma: 'difficulty', encounteredForm: 'difficulties', lemmaResolution: { lemma: 'difficulty', tags: ['form-of', 'plural'], source: { provider: 'wiktionary' } } } }
    const before = await service.snapshot(); await service.ingest([first, second]); const after = await service.snapshot()
    expect(after.vocabularies).toHaveLength(2)
    expect(after.vocabularies.map(value => value.contexts?.[0].id)).toEqual([context().id, context().id])
    expect(after.vocabularies.every(value => value.contexts?.[0].translation === context().translation)).toBe(true)
    expect((await service.ingest([first, second]))).toMatchObject({ skippedCaptureIds: [first.id, second.id] })
    expect(after.cards).toEqual(before.cards); expect(after.reviewEvents).toEqual(before.reviewEvents)
    expect((await decodeSnapshot(encodeSnapshot(after))).captures).toEqual(after.captures)
  })
  it('preserves translated context text and provenance when independent tags merge', () => {
    const base = snapshot(); base.vocabularies = [entryFromCapture(event())]
    const local = structuredClone(base), remote = structuredClone(base)
    local.vocabularies[0].revisionId = id(1820); local.vocabularies[0].contexts![0].translation = '人工译文'; local.vocabularies[0].contexts![0].translationSource = { provider: 'manual' }
    remote.vocabularies[0].revisionId = id(1821); remote.vocabularies[0].tags = ['independent']
    const merged = mergeSnapshots(base, local, remote)
    expect(merged.conflicts).toHaveLength(0)
    expect(merged.snapshot.vocabularies[0].contexts?.[0]).toMatchObject({ translation: '人工译文', translationSource: { provider: 'manual' } })
    expect(merged.snapshot.vocabularies[0].tags).toEqual(['independent'])
  })
  it('holds original form + lemma proof together on concurrent edits and exposes an explicit conflict', () => {
    const base = snapshot(); base.vocabularies = [entryFromCapture(event())]
    const local = structuredClone(base), remote = structuredClone(base)
    local.vocabularies[0].revisionId = id(1822); local.vocabularies[0].encounteredForm = 'persevering'
    remote.vocabularies[0].revisionId = id(1823); remote.vocabularies[0].lemma = 'other'; delete remote.vocabularies[0].lemmaResolution
    const merged = mergeSnapshots(base, local, remote)
    expect(merged.conflicts[0].fields).toEqual(expect.arrayContaining(['lemma', 'encounteredForm', 'lemmaResolution']))
    expect(merged.snapshot.vocabularies[0]).toMatchObject({ lemma: 'persevere', encounteredForm: 'persevering', lemmaResolution: { lemma: 'persevere' } })
  })
})

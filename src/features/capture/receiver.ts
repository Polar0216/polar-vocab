import { canonicalJson, type CaptureBatch, type CaptureEvent } from '../../../packages/shared'
import type { DataSnapshot } from '../../domain'
import { capturePreviewBudget } from '../../integrations/github/captures'
import { normalizeForDuplicate } from '../vocabulary/query'

export interface CapturePreviewRow { event: CaptureEvent; ingested: boolean; duplicateVocabularyIds: string[] }
export function buildCapturePreview(batches: readonly CaptureBatch[], snapshot: DataSnapshot): CapturePreviewRow[] {
  capturePreviewBudget(batches)
  const events = new Map<string, CaptureEvent>(), existing = new Map(snapshot.captures.map((event) => [event.id, event]))
  for (const batch of batches) for (const event of batch.events) {
    const previous = events.get(event.id) ?? existing.get(event.id)
    if (previous && canonicalJson(previous) !== canonicalJson(event)) throw new Error('同一采集ID出现不同内容，已停止预览；未覆盖原始事件。')
    events.set(event.id, event)
  }
  const receipts = new Set(snapshot.ingestedCaptureIds)
  return [...events.values()].map((event) => ({ event, ingested: receipts.has(event.id), duplicateVocabularyIds: snapshot.vocabularies.filter((entry) => !entry.deletedAt && entry.lang === event.payload.lang && normalizeForDuplicate(entry.lemma, entry.lang) === normalizeForDuplicate(event.payload.lemma, event.payload.lang)).map((entry) => entry.id) }))
}

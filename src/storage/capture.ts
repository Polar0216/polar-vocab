import { v5 as uuidV5 } from 'uuid'
import { vocabularyEntrySchema, type CaptureEvent, type VocabularyEntry } from '../domain'

/** Permanent protocol namespace: shared by all clients, not generated per installation. */
export const CAPTURE_NAMESPACE = '97bf633d-3fd0-5afd-9a4b-3f0fe7e44537'

export function entryFromCapture(event: CaptureEvent): VocabularyEntry {
  return vocabularyEntrySchema.parse({
    ...event.payload,
    id: uuidV5(`entry:${event.id}`, CAPTURE_NAMESPACE),
    schemaVersion: 1,
    revisionId: uuidV5(`initial-revision:${event.id}`, CAPTURE_NAMESPACE),
    parentRevisionIds: [],
    createdAt: event.capturedAt,
    updatedAt: event.capturedAt,
    origin: event.origin,
    status: 'inbox',
  })
}

/** Property order is irrelevant; array ordering and explicit null values remain meaningful. */
export function canonicalJson(value: unknown): string {
  function canonicalize(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(canonicalize)
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).filter(([, child]) => child !== undefined).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, canonicalize(child)]))
    }
    return item
  }
  return JSON.stringify(canonicalize(value))
}

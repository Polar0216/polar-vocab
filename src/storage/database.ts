import Dexie, { type Table } from 'dexie'
import type {
  AppSettings, CaptureEvent, DataSnapshot, Flashcard, PendingOperation,
  ReviewEvent, ReviewResolution, SyncConflict, SyncMetadata, Tombstone,
  VocabularyEntry,
} from '../domain'
import type { DevicePreferences, IngestedCapture } from './local-models'
import type { Connection, SyncJob, SyncLease, ConflictDecision } from './sync-models'

export const V1_STORES = {
  vocabularies: 'id, lang, status, [lang+status], updatedAt, deletedAt, *tags',
  cards: 'id, vocabularyId, [vocabularyId+template], fsrsState.due, suspended, deletedAt',
  reviewEvents: 'id, cardId, [cardId+parentStateId], reviewedAt',
  captures: 'id, deviceId, capturedAt',
  tombstones: 'id, [entityType+entityId], deletedAt',
  reviewResolutions: 'id, cardId, parentStateId',
  settings: 'id',
  syncMetadata: 'id, deviceId',
  syncBases: 'id',
  pendingOperations: 'id, createdAt, deviceId',
  conflicts: 'id, entityId, kind',
} as const

export const V2_STORES = {
  ...V1_STORES,
  devicePreferences: 'id, &deviceId, defaultLanguage',
  ingestedCaptures: 'id',
} as const
export const V3_STORES = { ...V2_STORES, connections: 'id', syncJobs: 'id, generation', syncLeases: 'id', conflictDecisions: 'id' } as const

export interface SyncBase {
  id: string
  schemaVersion: 1
  remoteSha: string
  snapshot: DataSnapshot
}

/** Construction opens nothing. V2/V3 only add tables; existing business records remain intact. */
export class PolarDatabase extends Dexie {
  declare vocabularies: Table<VocabularyEntry, string>
  declare cards: Table<Flashcard, string>
  declare reviewEvents: Table<ReviewEvent, string>
  declare captures: Table<CaptureEvent, string>
  declare tombstones: Table<Tombstone, string>
  declare reviewResolutions: Table<ReviewResolution, string>
  declare settings: Table<AppSettings, string>
  declare syncMetadata: Table<SyncMetadata, string>
  declare syncBases: Table<SyncBase, string>
  declare pendingOperations: Table<PendingOperation, string>
  declare conflicts: Table<SyncConflict, string>
  declare devicePreferences: Table<DevicePreferences, string>
  declare ingestedCaptures: Table<IngestedCapture, string>
  declare connections: Table<Connection, string>
  declare syncJobs: Table<SyncJob, string>
  declare syncLeases: Table<SyncLease, string>
  declare conflictDecisions: Table<ConflictDecision, string>

  constructor(name = 'polar-vocab') {
    super(name)
    this.version(1).stores(V1_STORES)
    this.version(2).stores(V2_STORES)
    this.version(3).stores(V3_STORES)
  }
}

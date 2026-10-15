import type { DataSnapshot, PendingOperation, SyncConflict, SyncMetadata, UUID } from '../../domain';

/** Frozen input; later local operations must never be acknowledged with this batch. */
export interface SyncBatch {
  readonly id: UUID;
  readonly base: DataSnapshot | null;
  readonly local: DataSnapshot;
  readonly operations: readonly PendingOperation[];
}

/** Persist before a PUT so a refresh or lost success response can recover safely. */
export interface SyncAttempt {
  readonly batchId: UUID;
  readonly capturedOperationIds: readonly UUID[];
  readonly expectedRemoteSha: string | null;
  readonly candidateSnapshotId: UUID;
  readonly candidateDigest: string;
}

export type SnapshotMergeResult =
  | { readonly status: 'merged'; readonly snapshot: DataSnapshot }
  | { readonly status: 'conflict'; readonly conflicts: readonly SyncConflict[] };

/** Merge policy to implement and test in Phase 3; generated revisions are persisted per attempt. */
export interface SnapshotMergerPort {
  merge(base: DataSnapshot | null, local: DataSnapshot, remote: DataSnapshot): SnapshotMergeResult;
}

export type SyncResult =
  | { readonly status: 'confirmed'; readonly metadata: SyncMetadata; readonly acknowledgedOperationIds: readonly UUID[] }
  | { readonly status: 'conflict'; readonly conflicts: readonly SyncConflict[] }
  | { readonly status: 'deferred'; readonly reason: 'offline' | 'unconfigured' | 'rate-limited' | 'busy' }
  | { readonly status: 'failed'; readonly code: string };

/** Original Phase 0 proposal; engine.ts exposes the executable coordinator and persisted SyncJob. */
export interface SyncCoordinatorPort {
  synchronize(): Promise<SyncResult>;
}

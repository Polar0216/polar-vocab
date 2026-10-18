import type { CaptureEvent, UUID } from '../../domain';

export type { CaptureBatch } from '../../../packages/shared/capture-batch';

export type CaptureIngestionResult =
  | { readonly status: 'saved'; readonly vocabularyIds: readonly UUID[]; readonly skippedCaptureIds: readonly UUID[] }
  | { readonly status: 'conflict'; readonly captureId: UUID; readonly reason: 'immutable-id' }
  | { readonly status: 'failed'; readonly reason: 'invalid-data' | 'incompatible-schema' | 'storage' };

/** Phase 1/4 implementation must atomically write capture, inbox entry, receipt and pending. */
export interface CaptureIngestionPort {
  ingest(events: readonly CaptureEvent[]): Promise<CaptureIngestionResult>;
}

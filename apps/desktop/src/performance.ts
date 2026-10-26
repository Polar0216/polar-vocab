import { z } from 'zod'
import { nativeStagesSchema, selectionFailureSchema, sourceCategorySchema } from './selection'

// Closed schema: never accepts a selection, error message, executable path, clipboard data or token.
export const capturePerformanceSchema = z.strictObject({
  schemaVersion: z.literal(1), at: z.iso.datetime(), requestId: z.uuid(),
  stage: z.enum(['feedback-show', 'feedback-paint', 'selection-ready', 'selection-paint', 'discarded']),
  elapsedMs: z.number().finite().min(0).max(120_000), sourceCategory: sourceCategorySchema,
  result: z.enum(['reading', 'busy', 'uia', 'clipboard', 'manual']), failure: selectionFailureSchema,
  native: nativeStagesSchema.optional(),
})

export const queryPerformanceSchema = z.strictObject({
  schemaVersion: z.literal(1), at: z.iso.datetime(), requestId: z.uuid(), captureId: z.uuid().optional(),
  stage: z.enum(['dictionary-ready', 'translation-ready', 'sentence-translation-ready']),
  elapsedMs: z.number().finite().min(0).max(120_000), result: z.enum(['success', 'partial', 'failed']),
})

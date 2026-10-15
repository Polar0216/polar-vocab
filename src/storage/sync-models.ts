import { z } from 'zod'
import { dataSnapshotSchema, pendingOperationSchema, syncConflictSchema, utcDateTimeSchema, uuidSchema } from '../domain'

export const connectionSchema = z.strictObject({ id: uuidSchema, schemaVersion: z.literal(1), owner: z.string(), repository: z.string(), branch: z.string(), path: z.literal('data/state.json'), auto: z.boolean(), authorized: z.boolean(), retryAt: z.number().nonnegative(), generation: uuidSchema })
export const syncJobSchema = z.strictObject({ id: uuidSchema, schemaVersion: z.literal(1), generation: uuidSchema, base: dataSnapshotSchema.nullable(), local: dataSnapshotSchema, operations: z.array(pendingOperationSchema), candidate: dataSnapshotSchema.nullable(), expectedSha: z.string().nullable(), createdAt: utcDateTimeSchema })
export const leaseSchema = z.strictObject({ id: uuidSchema, schemaVersion: z.literal(1), holder: uuidSchema, expiresAt: z.number() })
export const decisionSchema = z.strictObject({ id: uuidSchema, schemaVersion: z.literal(1), conflict: syncConflictSchema, choice: z.enum(['local', 'remote', 'keep-deleted', 'review', 'card', 'refresh']), createdAt: utcDateTimeSchema })
export type Connection = z.infer<typeof connectionSchema>
export type SyncJob = z.infer<typeof syncJobSchema>
export type SyncLease = z.infer<typeof leaseSchema>
export type ConflictDecision = z.infer<typeof decisionSchema>

import { z } from 'zod'
import { dataSnapshotSchema, type DataSnapshot } from '../../domain'
import { canonicalJson } from '../../storage/capture'
import { ApiError, MAX_REMOTE_BYTES, utf8Size } from '../../integrations/github/client'

export const PROTOCOL_VERSION = 1
export class ProtocolError extends Error { constructor() { super('远端协议、引用或学习状态不兼容；请保留备份并检查客户端版本。'); this.name = 'ProtocolError' } }
export const remoteEnvelopeSchema = z.strictObject({ format: z.literal('polar-vocab-state'), protocolVersion: z.literal(PROTOCOL_VERSION), schemaVersion: z.literal(1), snapshotId: z.uuid(), snapshot: dataSnapshotSchema })
const collections = ['vocabularies', 'cards', 'reviewEvents', 'captures', 'tombstones', 'reviewResolutions'] as const
export function normalized(snapshot: DataSnapshot): DataSnapshot {
  const result = structuredClone(snapshot)
  for (const collection of collections) result[collection].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  result.ingestedCaptureIds.sort()
  return result
}
export function logical(snapshot: DataSnapshot): string {
  const { id, exportedAt, ...data } = normalized(snapshot); void id; void exportedAt
  return canonicalJson(data)
}
export function encodeSnapshot(snapshot: DataSnapshot): string {
  const text = canonicalJson(remoteEnvelopeSchema.parse({ format: 'polar-vocab-state', protocolVersion: PROTOCOL_VERSION, schemaVersion: 1, snapshotId: snapshot.id, snapshot: normalized(snapshot) }))
  if (utf8Size(text) > MAX_REMOTE_BYTES) throw new ApiError('capacity')
  return text
}
export async function decodeSnapshot(text: string): Promise<DataSnapshot> {
  if (utf8Size(text) > MAX_REMOTE_BYTES) throw new ApiError('capacity')
  try {
    const envelope = remoteEnvelopeSchema.parse(JSON.parse(text))
    if (envelope.snapshotId !== envelope.snapshot.id) throw new ProtocolError()
    const { validateLearningSnapshot } = await import('../review/integrity')
    validateLearningSnapshot(envelope.snapshot, true)
    return envelope.snapshot
  } catch (error) { if (error instanceof ApiError) throw error; throw new ProtocolError() }
}

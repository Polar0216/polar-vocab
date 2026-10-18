import { z } from 'zod'
import { captureEventSchema } from '../../src/domain/vocabulary'
import { uuidSchema } from '../../src/domain/common'
import { canonicalJson } from '../../src/storage/capture'

export const MAX_BATCH_BYTES = 200_000
export const MAX_BATCH_EVENTS = 50
export const captureBatchSchema = z.strictObject({
  format: z.literal('polar-vocab-capture-batch'),
  protocolVersion: z.literal(1),
  schemaVersion: z.literal(1),
  id: uuidSchema,
  deviceId: uuidSchema,
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  events: z.array(captureEventSchema).min(1).max(MAX_BATCH_EVENTS),
}).superRefine((batch, context) => {
  const ids = new Set<string>()
  for (const [index, event] of batch.events.entries()) {
    if (ids.has(event.id) || event.deviceId !== batch.deviceId || event.origin !== 'windows' || !event.capturedAt.startsWith(batch.month + '-')) {
      context.addIssue({ code: 'custom', path: ['events', index], message: '批次必须包含唯一且同设备、同UTC月份的Windows采集事件。' })
    }
    ids.add(event.id)
  }
})
export type CaptureBatch = Readonly<z.infer<typeof captureBatchSchema>>
export function batchPath(batch: Pick<CaptureBatch, 'id' | 'deviceId' | 'month'>): string {
  uuidSchema.parse(batch.id); uuidSchema.parse(batch.deviceId)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(batch.month)) throw new Error('采集月份不合法。')
  return `captures/${batch.deviceId}/${batch.month}/${batch.id}.json`
}
export function isBatchPath(path: string): boolean {
  const match = /^captures\/([^/]+)\/(\d{4}-(?:0[1-9]|1[0-2]))\/([^/]+)\.json$/.exec(path)
  return Boolean(match && uuidSchema.safeParse(match[1]).success && uuidSchema.safeParse(match[3]).success)
}
export function encodeBatch(value: CaptureBatch): string {
  const text = canonicalJson(captureBatchSchema.parse(value))
  if (new TextEncoder().encode(text).length > MAX_BATCH_BYTES) throw new Error('采集批次超过200000字节，请减少单批记录。')
  return text
}
export function decodeBatch(text: string, path?: string): CaptureBatch {
  if (new TextEncoder().encode(text).length > MAX_BATCH_BYTES) throw new Error('采集批次过大，未导入。')
  const batch = captureBatchSchema.parse(JSON.parse(text))
  if (path && batchPath(batch) !== path) throw new Error('采集批次身份与文件路径不符。')
  return batch
}

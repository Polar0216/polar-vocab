import { z } from 'zod'
import { languageSchema, uuidSchema, vocabularyPayloadSchema, type CaptureEvent } from '../../../packages/shared'

export const desktopSettingsSchema = z.strictObject({
  shortcut: z.string().regex(/^(?:Control\+Alt|Control\+Shift|Alt\+Shift)\+[A-Z0-9]$/),
  language: languageSchema, theme: z.enum(['system', 'light', 'dark']),
  clipboardFallback: z.boolean(), autoLookup: z.boolean(), autoSync: z.boolean(),
})
export const defaultSettings: DesktopSettings = { shortcut: 'Control+Alt+S', language: 'en', theme: 'system', clipboardFallback: true, autoLookup: true, autoSync: false }
export type DesktopSettings = z.infer<typeof desktopSettingsSchema>
export const saveCommandSchema = z.strictObject({ id: uuidSchema, payload: vocabularyPayloadSchema })
export const lookupCommandSchema = z.strictObject({ id: uuidSchema, lang: languageSchema, text: z.string().trim().min(1).max(500) })
export const connectionInputSchema = z.strictObject({ owner: z.string().regex(/^[A-Za-z0-9-]{1,100}$/), repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/), branch: z.string().max(200), token: z.string().trim().min(10).max(512) })
export const queueQuerySchema = z.strictObject({ search: z.string().max(500), state: z.enum(['all', 'pending', 'uploading', 'acknowledged', 'failed', 'attention']), offset: z.number().int().min(0).max(100_000) })
export type QueueState = 'pending' | 'uploading' | 'acknowledged' | 'failed' | 'attention'
export interface QueueItem { event: CaptureEvent; state: QueueState; batchId: string | null; errorCode: string | null }
export interface SelectionResult { text: string; method: 'uia' | 'clipboard' | 'manual'; reason: string; source: string }
export interface LookupResult { text: string; provider: 'mymemory'; attribution: string }
export interface DesktopStatus { settings: DesktopSettings; deviceId: string; dataDirectory: string; shortcutRegistered: boolean; connected: boolean; target: string; syncing: boolean; counts: Record<QueueState, number>; lastError: string }
export type Reply<T> = { ok: true; value: T } | { ok: false; message: string }
export interface DesktopBridge {
  status(): Promise<Reply<DesktopStatus>>
  settings(value: DesktopSettings): Promise<Reply<DesktopStatus>>
  lookup(value: z.infer<typeof lookupCommandSchema>): Promise<Reply<LookupResult>>
  cancelLookup(id: string): Promise<Reply<boolean>>
  save(value: z.infer<typeof saveCommandSchema>): Promise<Reply<string>>
  queue(value: z.infer<typeof queueQuerySchema>): Promise<Reply<{ items: QueueItem[]; total: number }>>
  connect(value: z.infer<typeof connectionInputSchema>): Promise<Reply<string>>
  confirmConnection(): Promise<Reply<string>>
  cancelConnection(): Promise<Reply<boolean>>
  disconnect(): Promise<Reply<boolean>>
  sync(): Promise<Reply<string>>
  retry(): Promise<Reply<boolean>>
  exportQueue(): Promise<Reply<string>>
  openWebsite(): Promise<Reply<boolean>>
  hide(): Promise<Reply<boolean>>
  quit(): Promise<Reply<boolean>>
  onSelection(callback: (selection: SelectionResult) => void): () => void
}

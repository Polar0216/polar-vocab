import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { z } from 'zod'
import type { SelectionResult } from './contracts'

export const sourceCategorySchema = z.enum(['notepad', 'edge', 'chrome', 'other', 'unknown'])
export const selectionFailureSchema = z.enum(['none', 'no-window', 'focus-changed', 'protected', 'uia-timeout', 'no-selection', 'too-long', 'keys-held', 'clipboard-busy', 'clipboard-format', 'clipboard-changed', 'copy-failed', 'copy-empty', 'restore-failed', 'superseded', 'cancelled', 'worker-unavailable', 'worker-timeout'])
export const nativeStagesSchema = z.strictObject({ queueMs: z.number().nonnegative(), uiaMs: z.number().nonnegative(), keyReleaseMs: z.number().nonnegative(), clipboardBackupMs: z.number().nonnegative(), copyWaitMs: z.number().nonnegative(), readRestoreMs: z.number().nonnegative(), totalMs: z.number().nonnegative() })
const selectionSchema = z.strictObject({ text: z.string().max(20_000), method: z.enum(['uia', 'clipboard', 'manual']), reason: z.string().max(500), source: z.string().max(200) })
export interface SelectionOutcome { selection: SelectionResult; sourceCategory: z.infer<typeof sourceCategorySchema>; failure: z.infer<typeof selectionFailureSchema>; stages?: z.infer<typeof nativeStagesSchema> }
const responseSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready') }),
  z.strictObject({ type: z.literal('result'), id: z.uuid(), selection: selectionSchema, sourceCategory: sourceCategorySchema, failure: selectionFailureSchema, stages: nativeStagesSchema }),
])
export const manualOutcome = (failure: SelectionOutcome['failure'] = 'worker-unavailable'): SelectionOutcome => ({ selection: { text: '', method: 'manual', source: 'windows', reason: failure === 'worker-timeout' ? '取词超时，请直接输入或粘贴。' : '暂未取得选区，请直接输入或粘贴。' }, sourceCategory: 'unknown', failure })

/** One prewarmed native broker; it snapshots foreground on receipt and serializes clipboard work. */
export class SelectionReader {
  private child?: ChildProcessWithoutNullStreams
  private pending = new Map<string, { resolve: (value: SelectionOutcome) => void; timer: ReturnType<typeof setTimeout> }>()
  private buffer = ''
  private stopped = false
  private circuitOpen = false
  private readonly helper: string
  private readonly event: (code: 'worker-ready' | 'worker-exit' | 'worker-protocol') => void
  private readonly timeoutMs: number
  private readonly unsettled = new Set<string>()
  constructor(helper: string, event: SelectionReader['event'], timeoutMs = 1800) { this.helper = helper; this.event = event; this.timeoutMs = timeoutMs }
  warm(): void {
    if (this.child || this.stopped || this.circuitOpen) return
    const child = spawn(this.helper, ['--server'], { windowsHide: true, stdio: 'pipe' }); this.child = child
    child.stderr.resume() // Native diagnostics never enter application logs.
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (part: string) => {
      if (this.child !== child) return
      this.buffer += part
      if (this.buffer.length > 200_000) { this.event('worker-protocol'); child.kill(); return }
      let newline: number
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1)
        try {
          const message = responseSchema.parse(JSON.parse(line))
          if (message.type === 'ready') this.event('worker-ready')
          else {
            this.unsettled.delete(message.id)
            const request = this.pending.get(message.id)
            if (request) { clearTimeout(request.timer); this.pending.delete(message.id); request.resolve(message) }
            // A soft timeout never kills a helper that could still be restoring the clipboard.
            if (!this.unsettled.size) this.circuitOpen = false
          }
        } catch { this.event('worker-protocol'); child.kill(); return }
      }
    })
    const ended = () => {
      if (this.child !== child) return
      this.child = undefined; this.buffer = ''; this.circuitOpen = false; this.event('worker-exit')
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.resolve(manualOutcome()) }
      this.pending.clear(); this.unsettled.clear()
    }
    child.on('error', ended); child.on('exit', ended); child.stdin.on('error', () => undefined)
  }
  read(id: string, clipboardFallback: boolean, shortcut: string): Promise<SelectionOutcome> {
    if (this.stopped || this.circuitOpen) return Promise.resolve(manualOutcome())
    this.warm()
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.pending.delete(id); this.circuitOpen = true; this.write({ type: 'cancel', id }); resolve(manualOutcome('worker-timeout')) }, this.timeoutMs)
      this.pending.set(id, { resolve, timer })
      this.unsettled.add(id)
      this.write({ type: 'capture', id, clipboardFallback, excludeProcessId: process.pid, triggerKey: shortcut.at(-1)!.charCodeAt(0) })
    })
  }
  cancel(id: string): void { this.write({ type: 'cancel', id }) }
  private write(value: object): void { if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify(value) + '\n') }
  stop(): void { this.stopped = true; for (const id of this.pending.keys()) this.cancel(id); this.child?.stdin.end() }
}

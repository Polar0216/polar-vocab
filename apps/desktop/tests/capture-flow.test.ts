import { describe, expect, it, vi } from 'vitest'
import { CaptureFlow } from '../src/capture-flow'
import { manualOutcome, type SelectionOutcome } from '../src/selection'
import { capturePerformanceSchema } from '../src/performance'

function fixture() {
  const pending = new Map<string, (result: SelectionOutcome) => void>()
  const effects = { feedback: vi.fn(), cancel: vi.fn(), complete: vi.fn(), discarded: vi.fn(), read: vi.fn((id: string) => new Promise<SelectionOutcome>(resolve => pending.set(id, resolve))) }
  const flow = new CaptureFlow(effects)
  return { flow, effects, pending }
}
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }
describe('capture request ownership (ordering checks, not real performance measurements)', () => {
  it('provides synchronous feedback before starting a slow reader', async () => {
    const { flow, effects } = fixture(); flow.trigger()
    expect(effects.feedback).toHaveBeenCalledOnce(); expect(effects.read).not.toHaveBeenCalled(); expect(flow.reading).toBe(true)
    await settle(); expect(effects.read).toHaveBeenCalledOnce()
  })
  it('acknowledges every repeated trigger, cancels older work and only reveals the latest result', async () => {
    const { flow, effects, pending } = fixture(); flow.trigger(); await settle(); const first = effects.feedback.mock.calls[0][0]
    flow.trigger(); await settle(); const second = effects.feedback.mock.calls[1][0]
    expect(second).not.toBe(first); expect(effects.feedback.mock.calls[1][1]).toBe(true); expect(effects.cancel).toHaveBeenCalledWith(first)
    pending.get(second)!(manualOutcome()); await settle(); pending.get(first)!(manualOutcome()); await settle()
    expect(effects.complete).toHaveBeenCalledOnce(); expect(effects.complete.mock.calls[0][0]).toBe(second); expect(effects.discarded.mock.calls[0][0]).toBe(first); expect(flow.reading).toBe(false)
  })
  it('dismissal prevents an unfinished capture reopening the window', async () => {
    const { flow, effects, pending } = fixture(); flow.trigger(); await settle(); const id = effects.feedback.mock.calls[0][0]
    flow.dismiss(); pending.get(id)!(manualOutcome()); await settle()
    expect(effects.cancel).toHaveBeenCalledWith(id); expect(effects.complete).not.toHaveBeenCalled(); expect(flow.reading).toBe(false)
  })
  it('reader exceptions still produce a manual input result', async () => {
    const { flow, effects } = fixture(); effects.read.mockRejectedValueOnce(new Error('private diagnostic never logged')); flow.trigger(); await settle()
    expect(effects.complete.mock.calls[0][1]).toEqual(manualOutcome()); expect(flow.reading).toBe(false)
  })
})
it('performance records reject text, tokens, paths, raw messages and arbitrary source names', () => {
  const record = { schemaVersion: 1, at: new Date().toISOString(), requestId: crypto.randomUUID(), stage: 'selection-ready', elapsedMs: 42, sourceCategory: 'notepad', result: 'manual', failure: 'no-selection' }
  expect(capturePerformanceSchema.safeParse(record).success).toBe(true)
  for (const field of ['text', 'meaning', 'clipboard', 'token', 'path', 'error']) expect(capturePerformanceSchema.safeParse({ ...record, [field]: 'sensitive' }).success).toBe(false)
  expect(capturePerformanceSchema.safeParse({ ...record, sourceCategory: 'private-executable' }).success).toBe(false)
})

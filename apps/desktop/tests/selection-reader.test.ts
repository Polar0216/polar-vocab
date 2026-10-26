import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { SelectionReader } from '../src/selection'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
function fixture(timeout = 1800) {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
  const write = vi.spyOn(child.stdin, 'write'), events = vi.fn(), reader = new SelectionReader('fixture.exe', events, timeout)
  const reply = (id: string) => child.stdout.write(JSON.stringify({ type: 'result', id, selection: { text: '', method: 'manual', source: 'windows', reason: '未取得选区。' }, sourceCategory: 'notepad', failure: 'no-selection', stages: { queueMs: 0, uiaMs: 1, keyReleaseMs: 0, clipboardBackupMs: 0, copyWaitMs: 0, readRestoreMs: 0, totalMs: 1 } }) + '\n')
  return { child, write, events, reader, reply }
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
it('reuses the native broker and sends IDs and options without selected contents', async () => {
  const { reader, child, write, reply } = fixture(); const first = crypto.randomUUID(), second = crypto.randomUUID()
  const a = reader.read(first, true, 'Control+Alt+S'), b = reader.read(second, false, 'Control+Shift+D')
  expect(spawn).toHaveBeenCalledOnce(); expect(spawn).toHaveBeenCalledWith('fixture.exe', ['--server'], { windowsHide: true, stdio: 'pipe' })
  const sent = write.mock.calls.map(call => JSON.parse(String(call[0])))
  expect(sent[0]).toEqual({ type: 'capture', id: first, clipboardFallback: true, excludeProcessId: process.pid, triggerKey: 83 })
  reader.cancel(first); expect(JSON.parse(String(write.mock.calls.at(-1)![0]))).toEqual({ type: 'cancel', id: first })
  reply(first); reply(second); expect((await a).failure).toBe('no-selection'); expect((await b).sourceCategory).toBe('notepad')
  reader.stop(); child.emit('exit', 0)
})
it('soft timeout gives manual input and does not kill a broker that may be restoring the clipboard', async () => {
  vi.useFakeTimers(); const { reader, child, reply } = fixture(), id = crypto.randomUUID()
  const result = reader.read(id, true, 'Control+Alt+S'); await vi.advanceTimersByTimeAsync(1800)
  expect((await result).failure).toBe('worker-timeout'); expect(child.kill).not.toHaveBeenCalled()
  expect((await reader.read(crypto.randomUUID(), true, 'Control+Alt+S')).failure).toBe('worker-unavailable')
  reply(id); const next = crypto.randomUUID(), recovered = reader.read(next, true, 'Control+Alt+S'); reply(next)
  expect((await recovered).failure).toBe('no-selection'); reader.stop(); child.emit('exit', 0)
})
it('worker exit resolves pending work and the next request starts a fresh broker', async () => {
  const { reader, child, reply } = fixture(); const pending = reader.read(crypto.randomUUID(), true, 'Control+Alt+S')
  child.emit('exit', 1); expect((await pending).failure).toBe('worker-unavailable')
  const id = crypto.randomUUID(), next = reader.read(id, true, 'Control+Alt+S'); expect(spawn).toHaveBeenCalledTimes(2); reply(id)
  await next; reader.stop(); child.emit('exit', 0)
})

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { CaptureQueue } from '../src/queue'
import { CaptureUploader } from '../src/uploader'
import { CaptureGitHubFake } from '../../../tests/mocks/capture-github'
import { emptyLexicon, editSense, manualSense, type CaptureEvent } from '../../../packages/shared'

const root = resolve('.cache/phase4-unit'); mkdirSync(root, { recursive: true })
const queues: CaptureQueue[] = []
function setup() { const path = join(mkdtempSync(join(root, 'queue-')), 'captures.sqlite'), queue = new CaptureQueue(path); queues.push(queue); return { queue, path } }
function event(queue: CaptureQueue, lemma = 'artificial-example'): CaptureEvent { return { id: randomUUID(), schemaVersion: 1, deviceId: queue.deviceId, capturedAt: '2026-10-18T01:00:00.000Z', origin: 'windows', payload: { lang: 'en', lemma, meanings: ['人工测试释义'] } } }
afterEach(() => { for (const queue of queues) { try { queue.close() } catch { /* Already closed during a restart test. */ } } queues.length = 0 })
describe('actual SQLite local outbox', () => {
  it('persists structured senses beside legacy events without rewriting IDs, then freezes protocol2', () => {
    const { queue, path } = setup(), legacy = event(queue), structured = event(queue, 'structured-artificial')
    const lexicon = { ...emptyLexicon(), senses: [editSense(manualSense(), 'chinese', '人工结构化义项')] }
    structured.payload.lexicon = lexicon; structured.payload.meanings = ['人工结构化义项']
    queue.save(legacy); queue.save(structured); queue.save(structured); queue.close()
    const reopened = new CaptureQueue(path); queues.push(reopened)
    expect(reopened.find(legacy.id)).toEqual(legacy); expect(reopened.find(structured.id)).toEqual(structured)
    expect(reopened.list('', 'all').total).toBe(2)
    const frozen = reopened.freeze('artificial-target')!.batch
    expect(frozen.protocolVersion).toBe(2); expect(frozen.events.find(item => item.id === structured.id)?.payload.lexicon).toEqual(lexicon)
  })
  it('saves immediately, retries the original ID, and survives a real database close/reopen', () => {
    const { queue, path } = setup(), original = event(queue); queue.save(original); queue.save(original)
    expect(queue.list('', 'all').total).toBe(1); queue.close()
    const reopened = new CaptureQueue(path); queues.push(reopened)
    expect(reopened.deviceId).toBe(original.deviceId); expect(reopened.find(original.id)).toEqual(original); expect(reopened.counts().pending).toBe(1)
  })
  it('rejects a changed payload with the same ID and does not overwrite', () => {
    const { queue } = setup(), original = event(queue); queue.save(original)
    expect(() => queue.save({ ...original, payload: { lang: 'en', lemma: 'different' } })).toThrow()
    expect(queue.find(original.id)).toEqual(original)
  })
  it('rejects another device or a non-Windows capture before writing', () => {
    const { queue } = setup(), original = event(queue)
    expect(() => queue.save({ ...original, deviceId: randomUUID() })).toThrow('本机')
    expect(() => queue.save({ ...original, origin: 'web' })).toThrow('本机')
    expect(queue.counts().pending).toBe(0)
  })
  it('ACKs only the frozen event set, retaining captures added during upload', () => {
    const { queue } = setup(), first = event(queue); queue.save(first)
    const frozen = queue.freeze('test-target')!.batch; queue.uploading(frozen)
    const later = event(queue, 'after-freeze'); queue.save(later); queue.acknowledge(frozen, 'b'.repeat(40))
    expect(queue.list('', 'pending').items.map((row) => row.event.id)).toEqual([later.id])
    expect(queue.list('', 'acknowledged').items.map((row) => row.event.id)).toEqual([first.id])
  })
  it('preserves original batch IDs and body after process interruption and refuses target changes', () => {
    const { queue, path } = setup(); queue.save(event(queue)); const first = queue.freeze('first-target')!.batch; queue.uploading(first); queue.close()
    const reopened = new CaptureQueue(path); queues.push(reopened)
    expect(reopened.counts().failed).toBe(1); expect(reopened.freeze('first-target')!.batch).toEqual(first)
    expect(() => reopened.freeze('another-target')).toThrow('另一仓库')
  })
  it('rolls back an actual SQLite insertion failure and an ACK transaction failure', () => {
    const { queue, path } = setup(), fault = new DatabaseSync(path), original = event(queue)
    fault.exec("CREATE TRIGGER injected_save BEFORE INSERT ON captures BEGIN SELECT RAISE(ABORT,'injected'); END;")
    expect(() => queue.save(original)).toThrow(); expect(queue.list('', 'all').total).toBe(0)
    fault.exec('DROP TRIGGER injected_save'); queue.save(original)
    const frozen = queue.freeze('test-target')!.batch; queue.uploading(frozen)
    fault.exec("CREATE TRIGGER injected_ack BEFORE UPDATE ON captures WHEN NEW.state='acknowledged' BEGIN SELECT RAISE(ABORT,'injected'); END;")
    expect(() => queue.acknowledge(frozen, 'c'.repeat(40))).toThrow()
    expect(queue.counts().uploading).toBe(1); expect(JSON.parse(queue.export()).batches[0].state).toBe('uploading'); fault.close()
  })
  it('bounds batches, preserves month identity and exports without credentials', () => {
    const { queue } = setup(); for (let i = 0; i < 55; i++) queue.save(event(queue, 'word-' + i))
    const frozen = queue.freeze('test-target')!.batch; expect(frozen.events).toHaveLength(50)
    queue.acknowledge(frozen, 'c'.repeat(40)); expect(queue.freeze('test-target')!.batch.events).toHaveLength(5)
    expect(queue.list('word-1', 'all').total).toBeGreaterThan(0)
    expect(queue.export()).not.toMatch(/authorization|github_pat_|"token"/i)
  })
})
describe('desktop upload recovery through the actual HTTP adapter (simulated server)', () => {
  it('retains uncertain uploads across restart and confirms the same remote file without duplicate commits', async () => {
    const { queue, path } = setup(), fake = new CaptureGitHubFake(), first = event(queue); queue.save(first)
    const uploader = new CaptureUploader(queue, fake.fetch)
    await uploader.test({ owner: 'capture-test', repository: 'data', branch: 'main', token: 'artificial-test-credential' }); uploader.confirm()
    fake.loseNextResponse = true; await expect(uploader.sync()).rejects.toMatchObject({ code: 'network' }); expect(queue.counts().failed).toBe(1)
    uploader.endSession(); queue.close()
    const reopened = new CaptureQueue(path); queues.push(reopened); const resumed = new CaptureUploader(reopened, fake.fetch)
    await resumed.test({ owner: 'capture-test', repository: 'data', branch: 'main', token: 'artificial-test-credential' }); resumed.confirm(); await resumed.sync()
    expect(reopened.counts().acknowledged).toBe(1); expect(fake.writes).toHaveLength(1); expect(fake.writes[0]).toMatch(/^captures\//)
    expect(reopened.find(first.id)).toEqual(first)
  })
  it('preserves queue contents after a genuine client-classified unauthorized response', async () => {
    const { queue } = setup(), fake = new CaptureGitHubFake(), original = event(queue); queue.save(original)
    const uploader = new CaptureUploader(queue, fake.fetch); await uploader.test({ owner: 'capture-test', repository: 'data', branch: 'main', token: 'artificial-test-credential' }); uploader.confirm(); fake.failStatus = 401
    await expect(uploader.sync()).rejects.toMatchObject({ code: 'unauthorized' }); expect(uploader.connected()).toBe(false)
    expect(queue.find(original.id)).toEqual(original); expect(queue.counts().failed).toBe(1)
  })
})

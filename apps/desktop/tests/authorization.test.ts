import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CaptureQueue } from '../src/queue'
import { CaptureUploader } from '../src/uploader'
import { AuthorizationController } from '../src/authorization'
import { CredentialError, WindowsCredentialVault, credentialKey, type CredentialRunner, type CredentialTarget, type CredentialVault, type RememberedCredential } from '../src/credentials'
import { CaptureGitHubFake } from '../../../tests/mocks/capture-github'

const root = resolve('.cache/integrated-auth'); mkdirSync(root, { recursive: true })
const artificial = 'artificial-auth-value-not-a-real-token'
const target = { owner: 'capture-test', repository: 'data', branch: 'main' }
const queues: CaptureQueue[] = []
function setup(vault: CredentialVault = new MemoryVault()) {
  const directory = mkdtempSync(join(root, 'unit-')), path = join(directory, 'captures.sqlite'), queue = new CaptureQueue(path), fake = new CaptureGitHubFake()
  queues.push(queue)
  const uploader = new CaptureUploader(queue, fake.fetch), authorization = new AuthorizationController(queue, uploader, vault)
  return { path, directory, queue, fake, uploader, authorization, vault }
}
class MemoryVault implements CredentialVault {
  readonly backend = 'Artificial in-memory vault'
  records = new Map<string, RememberedCredential>()
  removed: string[] = []
  promptValue: string | null = artificial
  async read(target: CredentialTarget) { return this.records.get(credentialKey(target)) ?? null }
  async write(target: CredentialTarget, token: string) { this.records.set(credentialKey(target), { target, token }) }
  async remove(target: CredentialTarget) { this.records.delete(credentialKey(target)); this.removed.push(credentialKey(target)) }
  async prompt() { return this.promptValue }
}
afterEach(() => { for (const queue of queues) { try { queue.close() } catch { /* Already closed for a restart. */ } } queues.length = 0 })

describe('main-process authorization controller (artificial GitHub and credential responses)', () => {
  it('requires successful read-only preflight and explicit remember confirmation', async () => {
    const { authorization, queue, fake, vault } = setup()
    await expect(authorization.confirm({ remember: true })).rejects.toThrow('只读')
    await authorization.preflight({ ...target, branch: '', token: artificial })
    expect(fake.writes).toHaveLength(0); expect(queue.connection()).toBeUndefined()
    await authorization.confirm({ remember: true })
    expect(authorization.status()).toMatchObject({ remembered: true, state: 'connected' })
    expect((await vault.read(target))?.token).toBe(artificial)
    expect(JSON.stringify(authorization.status())).not.toContain(artificial)
    expect(queue.export()).not.toContain(artificial)
  })
  it('restores a remembered credential after queue close/reopen without token input', async () => {
    const { authorization, queue, path, fake, vault } = setup()
    await authorization.preflight({ ...target, token: artificial }); await authorization.confirm({ remember: true })
    authorization.endSession(); queue.close()
    const reopened = new CaptureQueue(path); queues.push(reopened)
    const uploader = new CaptureUploader(reopened, fake.fetch), restarted = new AuthorizationController(reopened, uploader, vault)
    await restarted.restore()
    expect(restarted.status()).toMatchObject({ state: 'connected', remembered: true })
    expect(uploader.connected()).toBe(true); expect(fake.writes).toHaveLength(0)
  })
  it('preserves credentials and queue for offline, permissions, rate limits and inaccessible targets', async () => {
    const { authorization, queue, fake, vault } = setup()
    await authorization.preflight({ ...target, token: artificial }); await authorization.confirm({ remember: true }); authorization.endSession()
    for (const [status, state] of [[503, 'offline'], [403, 'permission-required'], [404, 'not-found'], [429, 'offline']] as const) {
      fake.failStatus = status
      await authorization.restore()
      expect(authorization.status()).toMatchObject({ state, remembered: true })
      expect((await vault.read(target))?.token).toBe(artificial)
      expect(queue.connection()).toEqual(target)
    }
    fake.failStatus = 0; await authorization.restore(); expect(authorization.status().state).toBe('connected')
  })
  it('clears only an actually unauthorized remembered credential and requests reauthorization', async () => {
    const { authorization, queue, fake, vault } = setup()
    await authorization.preflight({ ...target, token: artificial }); await authorization.confirm({ remember: true }); authorization.endSession()
    fake.failStatus = 401; await authorization.restore()
    expect(authorization.status()).toMatchObject({ state: 'reauthorize', remembered: false })
    expect(await vault.read(target)).toBeNull(); expect(queue.connection()).toEqual(target)
  })
  it('removes saved credentials on disconnect; repeated restore never resurrects the session', async () => {
    const { authorization, uploader, queue, vault } = setup()
    await authorization.preflight({ ...target, token: artificial }); await authorization.confirm({ remember: true })
    await authorization.disconnect(); await authorization.restore()
    expect(queue.connection()).toBeUndefined(); expect(await vault.read(target)).toBeNull()
    expect(uploader.connected()).toBe(false); expect(authorization.status().state).toBe('disconnected')
  })
  it('does not persist without consent and handles cancelled native prompts', async () => {
    const vault = new MemoryVault(), { authorization } = setup(vault)
    vault.promptValue = null; expect(await authorization.prompt(target)).toBeNull()
    await authorization.preflight({ ...target, token: artificial }); await authorization.confirm({ remember: false })
    expect(vault.records.size).toBe(0); expect(authorization.status()).toMatchObject({ remembered: false, state: 'connected' })
    authorization.endSession(); await authorization.restore(); expect(authorization.status().state).toBe('disconnected')
  })
  it('does not supersede an open native prompt when restore is requested', async () => {
    const vault = new MemoryVault(), { authorization } = setup(vault)
    let release: (value: string | null) => void = () => undefined
    vault.prompt = () => new Promise<string | null>(resolve => { release = resolve })
    const prompt = authorization.prompt(target)
    expect(authorization.status().state).toBe('checking')
    await authorization.restore()
    expect(authorization.status().state).toBe('checking')
    release(artificial)
    expect(await prompt).toBe(artificial)
    await authorization.preflight({ ...target, token: artificial })
    await authorization.confirm({ remember: false })
    expect(authorization.status()).toMatchObject({ state: 'connected', remembered: false })
  })
  it('cancels stale preflights when disconnect occurs during a request', async () => {
    const vault = new MemoryVault(), { queue } = setup(vault)
    let release: () => void = () => undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const fake = new CaptureGitHubFake(), fetcher: typeof fetch = async (url, options) => { await gate; return fake.fetch(url, options) }
    const uploader = new CaptureUploader(queue, fetcher), authorization = new AuthorizationController(queue, uploader, vault)
    const checking = authorization.preflight({ ...target, token: artificial })
    await authorization.disconnect(); release()
    await expect(checking).rejects.toThrow()
    expect(uploader.connected()).toBe(false); expect(uploader.previewTarget()).toBeUndefined()
    expect(authorization.status().state).toBe('disconnected'); expect(queue.connection()).toBeUndefined()
  })
  it('does not enable remembered sessions if the secure store cannot persist', async () => {
    const vault = new MemoryVault(); vault.write = async () => { throw new CredentialError() }
    const { authorization, uploader } = setup(vault)
    await authorization.preflight({ ...target, token: artificial })
    await expect(authorization.confirm({ remember: true })).rejects.toBeInstanceOf(CredentialError)
    expect(uploader.connected()).toBe(false); expect(authorization.status().state).toBe('credential-error')
  })
  it('does not restore an old credential when disconnect races a new remembered confirmation', async () => {
    const vault = new MemoryVault(), { authorization, queue } = setup(vault)
    await authorization.preflight({ ...target, token: artificial }); await authorization.confirm({ remember: true })
    const originalWrite = vault.write.bind(vault)
    let entered: () => void = () => undefined, release: () => void = () => undefined
    const started = new Promise<void>(resolve => { entered = resolve }), gate = new Promise<void>(resolve => { release = resolve })
    vault.write = async (target, token) => { entered(); await gate; await originalWrite(target, token) }
    await authorization.preflight({ ...target, token: 'another-artificial-session-value' })
    const confirmation = authorization.confirm({ remember: true })
    await started; await authorization.disconnect(); release()
    await expect(confirmation).rejects.toThrow()
    expect(await vault.read(target)).toBeNull(); expect(queue.connection()).toBeUndefined()
    expect(authorization.status()).toMatchObject({ state: 'disconnected', remembered: false })
  })
  it('cancels native prompt helpers on disconnect and discards a late token response', async () => {
    const runner: CredentialRunner = async (_path, command, signal) => command.op === 'prompt'
      ? new Promise(resolve => signal?.addEventListener('abort', () => resolve({ ok: true, found: true, value: artificial }), { once: true }))
      : { ok: true }
    const vault = new WindowsCredentialVault('unused', runner), { authorization } = setup(vault)
    const prompt = authorization.prompt(target)
    await authorization.disconnect()
    expect(await prompt).toBeNull(); expect(authorization.status().state).toBe('disconnected')
  })
  it('cancels a rejected native prompt without turning cancellation into a vault error', async () => {
    const runner: CredentialRunner = async (_path, command, signal) => command.op === 'prompt'
      ? new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new CredentialError()), { once: true }))
      : { ok: true }
    const { authorization } = setup(new WindowsCredentialVault('unused', runner))
    const prompt = authorization.prompt(target)
    authorization.cancelPreview()
    expect(await prompt).toBeNull()
    expect(authorization.status()).toMatchObject({ state: 'disconnected', remembered: false })
  })
})

describe('credential target binding and fixed helper protocol', () => {
  it('binds secrets to owner/repo/branch and refuses a swapped credential record', async () => {
    expect(credentialKey(target)).toBe(credentialKey({ ...target, owner: target.owner.toUpperCase() }))
    expect(credentialKey(target)).not.toBe(credentialKey({ ...target, branch: 'another' }))
    const runner: CredentialRunner = async () => ({ ok: true, found: true, value: JSON.stringify({ schemaVersion: 1, target: { ...target, repository: 'another' }, token: artificial }) })
    await expect(new WindowsCredentialVault('unused', runner).read(target)).rejects.toBeInstanceOf(CredentialError)
  })
  it('uses fixed app-scoped hashed keys and no token-bearing command-line arguments', async () => {
    const calls: { key?: string; op: string; target?: string }[] = []
    const runner: CredentialRunner = async (_path, command) => { calls.push(command); return command.op === 'prompt' ? { ok: true, found: false } : { ok: true } }
    const vault = new WindowsCredentialVault('fixed-helper-path', runner)
    await vault.write(target, artificial); await vault.remove(target); expect(await vault.prompt({ ...target, branch: '' })).toBeNull()
    expect(calls[0].key).toMatch(/^PolarVocab\.Capture\.GitHub\.v1\.[a-f0-9]{64}$/)
    expect(calls[2].target).toContain('默认分支')
  })
})

describe.skipIf(process.platform !== 'win32')('REAL Windows Credential Manager with artificial values (no real GitHub)', () => {
  const helper = join(root, 'CredentialHelper.exe')
  beforeAll(() => {
    execFileSync(join(process.env.WINDIR ?? 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/out:' + helper, '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll', resolve('apps/desktop/native/CredentialHelper.cs')], { windowsHide: true })
  })
  it('stores in the real per-user vault, restores after a real process restart, and disconnects without plaintext files', async () => {
    const realTarget = { owner: 'capture-test', repository: 'native-vault-' + randomUUID(), branch: 'main' }
    const vault = new WindowsCredentialVault(helper)
    expect(await vault.read(realTarget)).toBeNull()
    try {
      await vault.write(realTarget, artificial)
      const restarted = new WindowsCredentialVault(helper)
      expect((await restarted.read(realTarget))?.token).toBe(artificial)
      const binary = readFileSync(helper)
      expect(binary.includes(Buffer.from(artificial))).toBe(false)
      // The helper exits after every operation: each read above is a new native process.
      const { queue, fake, directory } = setup(vault)
      const map: typeof fetch = (input, options) => fake.fetch(String(input).replace('/' + realTarget.repository, '/data'), options)
      // Repository identity must match its synthetic metadata as well.
      const network: typeof fetch = async (input, options) => {
        if (new URL(String(input)).pathname === `/repos/${realTarget.owner}/${realTarget.repository}`) return Response.json({ private: true, full_name: `${realTarget.owner}/${realTarget.repository}`, default_branch: 'main' })
        return map(input, options)
      }
      queue.setConnection(realTarget)
      const authorization = new AuthorizationController(queue, new CaptureUploader(queue, network), restarted)
      await authorization.restore(); expect(authorization.status()).toMatchObject({ state: 'connected', remembered: true })
      for (const file of readdirSync(directory)) if (statSync(join(directory, file)).isFile()) expect(readFileSync(join(directory, file)).includes(Buffer.from(artificial))).toBe(false)
      await authorization.disconnect(); await authorization.restore(); expect(authorization.status().state).toBe('disconnected')
      expect(await vault.read(realTarget)).toBeNull()
    } finally { await vault.remove(realTarget) }
  })
})

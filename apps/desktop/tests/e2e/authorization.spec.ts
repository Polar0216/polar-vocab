/* eslint-disable no-empty-pattern -- Tests an isolated Electron fixture, not an external browser. */
import { _electron as electron, expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AuthorizationFixture } from '../fixtures/authorization-app'

test('REAL Windows vault + Electron process restarts; artificial GitHub: remember, offline, 401, disconnect and no renderer/plaintext credential', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Windows Credential Manager requires a real Windows user session.')
  const root = resolve('.cache/integrated-auth/electron'); mkdirSync(root, { recursive: true })
  const directory = mkdtempSync(join(root, 'run-')), profile = join(directory, 'profile'), fixture = join(directory, 'authorization-app.cjs'), helper = join(directory, 'CredentialHelper.exe')
  mkdirSync(profile)
  await build({ entryPoints: [resolve('apps/desktop/tests/fixtures/authorization-app.ts')], outfile: fixture, bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron', 'node:sqlite'] })
  execFileSync(join(process.env.WINDIR ?? 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/out:' + helper, '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll', resolve('apps/desktop/native/CredentialHelper.cs')], { windowsHide: true })
  const repository = 'auth-e2e-' + randomUUID()
  const launch = () => electron.launch({ args: [fixture], env: { ...process.env, POLAR_VOCAB_CAPTURE_DATA_DIR: profile, POLAR_VOCAB_AUTH_TEST_REPOSITORY: repository, POLAR_VOCAB_AUTH_TEST_HELPER: helper } })
  let app = await launch(), closed = false
  const results: unknown[] = []
  try {
    await app.evaluate(async () => { await (globalThis as unknown as { authorizationFixture: AuthorizationFixture }).authorizationFixture.ready })
    const first = await app.evaluate(async () => (globalThis as unknown as { authorizationFixture: AuthorizationFixture }).authorizationFixture.rememberArtificial())
    expect(first).toMatchObject({ state: 'connected', remembered: true }); results.push({ stage: 'first-remembered', status: first })
    await app.close(); app = await launch()
    await app.evaluate(async () => { await (globalThis as unknown as { authorizationFixture: AuthorizationFixture }).authorizationFixture.ready })
    const restored = await app.evaluate(() => (globalThis as unknown as { authorizationFixture: AuthorizationFixture }).authorizationFixture.status())
    expect(restored).toMatchObject({ state: 'connected', remembered: true }); results.push({ stage: 'new-electron-process-no-input', status: restored })
    const page = await app.firstWindow()
    expect(await page.evaluate(() => ({ bridge: typeof (window as unknown as { polarCapture?: unknown }).polarCapture, fixture: typeof (window as unknown as { authorizationFixture?: unknown }).authorizationFixture }))).toEqual({ bridge: 'undefined', fixture: 'undefined' })
    const offline = await app.evaluate(async () => (globalThis as unknown as { authorizationFixture: AuthorizationFixture }).authorizationFixture.restoreWithStatus(503))
    expect(offline).toMatchObject({ state: 'offline', remembered: true }); results.push({ stage: 'network-unavailable', status: offline })
    const recovered = await app.evaluate(async () => (globalThis as unknown as { authorizationFixture: AuthorizationFixture }).authorizationFixture.restoreWithStatus(0))
    expect(recovered.state).toBe('connected')
    const unauthorized = await app.evaluate(async () => (globalThis as unknown as { authorizationFixture: AuthorizationFixture }).authorizationFixture.restoreWithStatus(401))
    expect(unauthorized).toMatchObject({ state: 'reauthorize', remembered: false }); results.push({ stage: 'simulated-401', status: unauthorized })
    await app.evaluate(async () => { const fixture = (globalThis as unknown as { authorizationFixture: AuthorizationFixture }).authorizationFixture; await fixture.restoreWithStatus(0); await fixture.rememberArtificial(); await fixture.disconnect() })
    await app.close(); app = await launch()
    await app.evaluate(async () => { await (globalThis as unknown as { authorizationFixture: AuthorizationFixture }).authorizationFixture.ready })
    const disconnected = await app.evaluate(() => (globalThis as unknown as { authorizationFixture: AuthorizationFixture }).authorizationFixture.status())
    expect(disconnected).toMatchObject({ state: 'disconnected', remembered: false }); results.push({ stage: 'restart-after-disconnect', status: disconnected })
    expect(await app.evaluate(() => (globalThis as unknown as { authorizationFixture: AuthorizationFixture }).authorizationFixture.queueCount())).toBe(0)
    await app.close(); closed = true
    const probe = 'artificial-electron-auth-fixture-not-a-real-token'
    function inspect(path: string): boolean {
      for (const name of readdirSync(path)) {
        const file = join(path, name)
        if (statSync(file).isDirectory()) { if (!inspect(file)) return false }
        else { const content = readFileSync(file); if (content.includes(Buffer.from(probe)) || content.includes(Buffer.from(probe, 'utf16le'))) return false }
      }
      return true
    }
    await expect.poll(() => { try { return inspect(profile) } catch { return false } }, { timeout: 5000 }).toBe(true)
  } finally {
    if (!closed) {
      await app.evaluate(async () => { const fixture = (globalThis as unknown as { authorizationFixture: AuthorizationFixture }).authorizationFixture; await fixture.ready; await fixture.disconnect() }).catch(() => undefined)
      await app.close()
    }
    writeFileSync(info.outputPath('authorization-results.json'), JSON.stringify({ at: new Date().toISOString(), source: 'REAL Windows Credential Manager and Electron process restarts; artificial GitHub HTTP', results }, null, 2))
  }
})

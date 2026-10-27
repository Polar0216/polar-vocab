/* eslint-disable no-empty-pattern -- Drives only an isolated test Electron main process. */
import { _electron as electron, expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { CredentialPromptFixture } from '../fixtures/credential-prompt-app'

test('REAL Electron main launches a visible diagnostic WinExe over Unicode pipes and recovers after cancellation (no authentication)', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Native GUI-subsystem verification requires Windows.')
  const root = resolve('.cache/credential-window-diagnostic/electron'); mkdirSync(root, { recursive: true })
  const directory = mkdtempSync(join(root, 'run-')), profile = join(directory, 'profile'), fixture = join(directory, 'credential-prompt-app.cjs'), helper = join(directory, 'CredentialWindowDiagnostic.exe')
  mkdirSync(profile)
  await build({ entryPoints: [resolve('apps/desktop/tests/fixtures/credential-prompt-app.ts')], outfile: fixture, bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] })
  execFileSync(join(process.env.WINDIR ?? 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), [
    '/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/out:' + helper,
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll',
    resolve('apps/desktop/tests/fixtures/CredentialWindowDiagnostic.cs'),
  ], { windowsHide: true })
  const app = await electron.launch({ args: [fixture], env: { ...process.env, POLAR_VOCAB_GUI_TEST_PROFILE: profile, POLAR_VOCAB_GUI_TEST_HELPER: helper } })
  const results: unknown[] = []
  try {
    await app.evaluate(async () => { await (globalThis as unknown as { credentialPromptFixture: CredentialPromptFixture }).credentialPromptFixture.ready })
    const initial = await app.evaluate(async () => (globalThis as unknown as { credentialPromptFixture: CredentialPromptFixture }).credentialPromptFixture.prompt())
    expect(initial).toMatchObject({ shown: true, nativeVisible: true, receivedTarget: 'Electron main GUI diagnostic\n分支：main · Häuser' })
    results.push({ stage: 'actual-electron-main-visible-unicode-pipes', result: initial })
    const recovery = await app.evaluate(async () => (globalThis as unknown as { credentialPromptFixture: CredentialPromptFixture }).credentialPromptFixture.cancelAndRecover())
    expect(recovery).toMatchObject({ cancelled: true, next: { shown: true, nativeVisible: true, receivedTarget: 'Electron main diagnostic after cancel' } })
    results.push({ stage: 'actual-electron-main-cancel-and-retry', result: recovery })
    const page = await app.firstWindow()
    expect(await page.evaluate(() => typeof (window as unknown as { credentialPromptFixture?: unknown }).credentialPromptFixture)).toBe('undefined')
  } finally {
    await app.close()
    writeFileSync(info.outputPath('native-gui-results.json'), JSON.stringify({ at: new Date().toISOString(), source: 'REAL Windows diagnostic form and Electron main subprocess; no user authentication/vault/network', results }, null, 2))
  }
})

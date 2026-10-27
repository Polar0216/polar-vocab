import { beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CredentialError, runCredentialHelper } from '../src/credentials'

describe.skipIf(process.platform !== 'win32')('REAL Windows GUI-subsystem startup (diagnostic form, no authentication)', () => {
  let helper: string
  beforeAll(() => {
    const root = resolve('.cache/credential-window-diagnostic'); mkdirSync(root, { recursive: true })
    helper = join(mkdtempSync(join(root, 'run-')), 'CredentialWindowDiagnostic.exe')
    execFileSync(join(process.env.WINDIR ?? 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), [
      '/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/out:' + helper,
      '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll',
      resolve('apps/desktop/tests/fixtures/CredentialWindowDiagnostic.cs'),
    ], { windowsHide: true })
  })

  it('actually shows a GUI-subsystem form and roundtrips Unicode over the production pipes', async () => {
    const target = 'Artificial GUI diagnostic\n分支：main · Häuser'
    const result = await runCredentialHelper(helper, { op: 'prompt', target })
    expect(JSON.parse(result.value!)).toMatchObject({ shown: true, nativeVisible: true, receivedTarget: target })
  })

  it('aborts a stalled diagnostic GUI and permits another interactive launch', async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 300)
    try {
      await expect(runCredentialHelper(helper, { op: 'prompt', target: 'diagnostic-hold' }, controller.signal)).rejects.toBeInstanceOf(CredentialError)
    } finally { clearTimeout(timer) }
    const recovered = await runCredentialHelper(helper, { op: 'prompt', target: 'Artificial GUI diagnostic after cancel' })
    expect(JSON.parse(recovered.value!)).toMatchObject({ shown: true, nativeVisible: true })
  })
  it('fails promptly when a child never reports a ready window instead of waiting ten minutes', async () => {
    const started = performance.now()
    await expect(runCredentialHelper(helper, { op: 'prompt', target: 'diagnostic-hold' })).rejects.toThrow('授权窗口未能正常打开')
    expect(performance.now() - started).toBeLessThan(11000)
  }, 12000)
})

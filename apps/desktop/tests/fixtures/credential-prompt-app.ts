// Test-only Electron main process. The child displays an ordinary diagnostic
// form without credential fields, network access or Windows vault operations.
import { app, BrowserWindow } from 'electron'
import { CredentialError, runCredentialHelper } from '../../src/credentials'

interface DiagnosticResult { shown: boolean; nativeVisible: boolean; receivedTarget: string }
export interface CredentialPromptFixture {
  ready: Promise<void>
  prompt(): Promise<DiagnosticResult>
  cancelAndRecover(): Promise<{ cancelled: boolean; next: DiagnosticResult }>
}
const profile = process.env.POLAR_VOCAB_GUI_TEST_PROFILE!, helper = process.env.POLAR_VOCAB_GUI_TEST_HELPER!
if (!profile || !helper) throw new Error('Isolated GUI diagnostic paths required.')
app.setPath('userData', profile)
const controllers = new Set<AbortController>()
const ready = app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await window.loadURL('data:text/html,<html><body>GUI startup component fixture - no credentials</body></html>')
})
async function prompt(target: string): Promise<DiagnosticResult> {
  const reply = await runCredentialHelper(helper, { op: 'prompt', target })
  return JSON.parse(reply.value!) as DiagnosticResult
}
const fixture: CredentialPromptFixture = {
  ready,
  prompt: () => prompt('Electron main GUI diagnostic\n分支：main · Häuser'),
  cancelAndRecover: async () => {
    const controller = new AbortController(); controllers.add(controller)
    const timer = setTimeout(() => controller.abort(), 300)
    let cancelled = false
    try { await runCredentialHelper(helper, { op: 'prompt', target: 'diagnostic-hold' }, controller.signal) }
    catch (error) { if (!(error instanceof CredentialError)) throw error; cancelled = true }
    finally { clearTimeout(timer); controllers.delete(controller) }
    return { cancelled, next: await prompt('Electron main diagnostic after cancel') }
  },
}
Object.assign(globalThis, { credentialPromptFixture: fixture })
app.on('before-quit', () => { for (const controller of controllers) controller.abort() })

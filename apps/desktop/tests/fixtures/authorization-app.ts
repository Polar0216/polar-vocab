// Test-only app: a real Electron lifecycle and Windows vault, artificial GitHub.
// It is never included in production builds or exposed through renderer IPC.
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { CaptureQueue } from '../../src/queue'
import { CaptureUploader } from '../../src/uploader'
import { AuthorizationController, type AuthorizationStatus } from '../../src/authorization'
import { WindowsCredentialVault } from '../../src/credentials'
import { CaptureGitHubFake } from '../../../../tests/mocks/capture-github'

export interface AuthorizationFixture {
  ready: Promise<void>
  status(): AuthorizationStatus
  rememberArtificial(): Promise<AuthorizationStatus>
  restoreWithStatus(status: number): Promise<AuthorizationStatus>
  disconnect(): Promise<void>
  queueCount(): number
}
const profile = process.env.POLAR_VOCAB_CAPTURE_DATA_DIR!, repository = process.env.POLAR_VOCAB_AUTH_TEST_REPOSITORY!, helper = process.env.POLAR_VOCAB_AUTH_TEST_HELPER!
if (!profile || !/^auth-e2e-[a-f0-9-]+$/.test(repository) || !helper) throw new Error('Isolated synthetic auth fixture required.')
app.setPath('userData', profile)
const target = { owner: 'capture-test', repository, branch: 'main' }, fake = new CaptureGitHubFake()
let queue: CaptureQueue, authorization: AuthorizationController
const network: typeof fetch = async (input, options) => {
  if (!fake.failStatus && new URL(String(input)).pathname === `/repos/${target.owner}/${target.repository}`) return Response.json({ private: true, full_name: `${target.owner}/${target.repository}`, default_branch: 'main' })
  return fake.fetch(String(input).replace('/' + target.repository, '/data'), options)
}
const ready = app.whenReady().then(async () => {
  queue = new CaptureQueue(join(profile, 'captures.sqlite'))
  authorization = new AuthorizationController(queue, new CaptureUploader(queue, network), new WindowsCredentialVault(helper))
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await window.loadURL('data:text/html,<html><body>Artificial authorization lifecycle fixture</body></html>')
  await authorization.restore()
})
const fixture: AuthorizationFixture = {
  ready, status: () => authorization.status(),
  rememberArtificial: async () => {
    await authorization.preflight({ ...target, token: 'artificial-electron-auth-fixture-not-a-real-token' })
    await authorization.confirm({ remember: true }); return authorization.status()
  },
  restoreWithStatus: async status => { fake.failStatus = status; authorization.endSession(); await authorization.restore(); return authorization.status() },
  disconnect: () => authorization.disconnect(), queueCount: () => queue.list('', 'all').total,
}
Object.assign(globalThis, { authorizationFixture: fixture })
app.on('before-quit', () => authorization?.endSession())
app.on('will-quit', () => queue?.close())

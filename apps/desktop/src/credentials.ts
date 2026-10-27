import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { canonicalJson } from '../../../packages/shared'

export const credentialTargetSchema = z.strictObject({ owner: z.string().regex(/^[A-Za-z0-9-]{1,100}$/), repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/), branch: z.string().min(1).max(200) })
export type CredentialTarget = z.infer<typeof credentialTargetSchema>
const secretSchema = z.strictObject({ schemaVersion: z.literal(1), target: credentialTargetSchema, token: z.string().trim().min(10).max(512) })
export interface RememberedCredential { target: CredentialTarget; token: string }
export interface CredentialVault {
  readonly backend: string
  read(target: CredentialTarget): Promise<RememberedCredential | null>
  write(target: CredentialTarget, token: string): Promise<void>
  remove(target: CredentialTarget): Promise<void>
  prompt(target: CredentialTarget): Promise<string | null>
  cancelPrompt?(): void
}
export class CredentialError extends Error {
  readonly code = 'credential-storage'
  constructor(operation?: 'prompt') { super(operation === 'prompt' ? '授权窗口未能正常打开或已中断，请重试；本机队列和已保存凭证保留。' : 'Windows 凭证管理器暂不可用，未把凭证明文保存；请重试或仅使用当前会话。'); this.name = 'CredentialError' }
}
function validatedTarget(target: CredentialTarget): CredentialTarget { return credentialTargetSchema.parse({ owner: target.owner, repository: target.repository, branch: target.branch }) }
function identity(target: CredentialTarget): string { return canonicalJson({ ...validatedTarget(target), owner: target.owner.toLowerCase(), repository: target.repository.toLowerCase() }) }
export function credentialKey(target: CredentialTarget): string { return 'PolarVocab.Capture.GitHub.v1.' + createHash('sha256').update(identity(target)).digest('hex') }
type Command = { op: 'read' | 'delete'; key: string } | { op: 'write'; key: string; value: string } | { op: 'prompt'; target: string }
const replySchema = z.object({ ok: z.boolean(), found: z.boolean().optional(), value: z.string().max(4096).nullable().optional() })
export type CredentialRunner = (path: string, command: Command, signal?: AbortSignal) => Promise<z.infer<typeof replySchema>>

/** Secret input/output stays in redirected anonymous pipes, never argv/env/files. */
export const runCredentialHelper: CredentialRunner = (path, command, signal) => new Promise((resolve, reject) => {
  if (process.platform !== 'win32') { reject(new CredentialError()); return }
  const timeout = command.op === 'prompt' ? 10 * 60_000 : 5000
  // Hidden startup can affect the first WinForms window. A GUI-subsystem
  // helper needs no console hiding for its interactive prompt.
  let startupTimer: ReturnType<typeof setTimeout> | undefined
  const child = execFile(path, [], { encoding: 'utf8', windowsHide: command.op !== 'prompt', timeout, maxBuffer: 32_768, signal }, (error, stdout) => {
    clearTimeout(startupTimer)
    if (error) { reject(new CredentialError(command.op === 'prompt' ? 'prompt' : undefined)); return }
    const parsed = replySchema.safeParse((() => { try { return JSON.parse(stdout) } catch { return null } })())
    if (!parsed.success || !parsed.data.ok) { reject(new CredentialError(command.op === 'prompt' ? 'prompt' : undefined)); return }
    resolve(parsed.data)
  })
  if (command.op === 'prompt') {
    // Wait ten minutes only AFTER the native window reports visible. An absent
    // window must release the UI promptly instead of leaving every button busy.
    startupTimer = setTimeout(() => { reject(new CredentialError('prompt')); child.kill() }, 8000)
    startupTimer.unref()
    let readiness = ''
    child.stderr?.on('data', chunk => {
      readiness = (readiness + String(chunk)).slice(-128)
      if (readiness.includes('polar-credential-prompt-ready')) clearTimeout(startupTimer)
    })
  }
  child.stdin?.on('error', () => reject(new CredentialError()))
  const payload = Buffer.from(JSON.stringify(command), 'utf8')
  child.stdin?.end(payload, () => payload.fill(0))
})

/** Current Windows user's non-roaming Generic Credential; independent of app versions. */
export class WindowsCredentialVault implements CredentialVault {
  readonly backend = 'Windows Credential Manager (current user, local machine)'
  private readonly helper: string
  private readonly run: CredentialRunner
  private promptController?: AbortController
  constructor(helper: string, runner: CredentialRunner = runCredentialHelper) { this.helper = helper; this.run = runner }
  async prompt(target: CredentialTarget): Promise<string | null> {
    validatedTarget({ ...target, branch: target.branch || 'main' })
    if (this.promptController) throw new CredentialError()
    const controller = new AbortController(); this.promptController = controller
    try {
      const reply = await this.run(this.helper, { op: 'prompt', target: `${target.owner}/${target.repository}\n分支：${target.branch || '默认分支'}` }, controller.signal)
      if (!reply.found || controller.signal.aborted) return null
      const result = z.string().trim().min(10).max(512).safeParse(reply.value)
      if (!result.success) throw new CredentialError()
      return result.data
    } finally { if (this.promptController === controller) this.promptController = undefined }
  }
  cancelPrompt(): void { this.promptController?.abort() }
  async read(target: CredentialTarget): Promise<RememberedCredential | null> {
    const reply = await this.run(this.helper, { op: 'read', key: credentialKey(target) })
    if (!reply.found) return null
    let value: unknown
    try { value = JSON.parse(reply.value ?? '') } catch { throw new CredentialError() }
    const record = secretSchema.safeParse(value)
    if (!record.success || identity(record.data.target) !== identity(target)) throw new CredentialError()
    return { target: record.data.target, token: record.data.token }
  }
  async write(target: CredentialTarget, token: string): Promise<void> {
    const value = secretSchema.parse({ schemaVersion: 1, target: validatedTarget(target), token })
    const serialized = canonicalJson(value)
    if (Buffer.byteLength(serialized, 'utf8') > 2560) throw new CredentialError()
    await this.run(this.helper, { op: 'write', key: credentialKey(target), value: serialized })
  }
  async remove(target: CredentialTarget): Promise<void> { await this.run(this.helper, { op: 'delete', key: credentialKey(target) }) }
}

import { ApiError } from '../../../src/integrations/github/client'
import type { CaptureQueue } from './queue'
import type { CaptureUploader } from './uploader'
import { CredentialError, type CredentialTarget, type CredentialVault, type RememberedCredential } from './credentials'

export type AuthorizationState = 'disconnected' | 'checking' | 'connected' | 'offline' | 'permission-required' | 'reauthorize' | 'not-found' | 'credential-error' | 'error'
export interface AuthorizationStatus { remembered: boolean; state: AuthorizationState; message: string; backend: string }
type ConnectionInput = CredentialTarget & { token: string }
const sameTarget = (a: CredentialTarget | undefined, b: CredentialTarget | undefined): boolean => Boolean(a && b && a.owner.toLowerCase() === b.owner.toLowerCase() && a.repository.toLowerCase() === b.repository.toLowerCase() && a.branch === b.branch)

/** Main-process-only state. Neither saved nor newly entered tokens are returned by status. */
export class AuthorizationController {
  private readonly queue: CaptureQueue
  private readonly uploader: CaptureUploader
  private readonly vault: CredentialVault
  private preview?: ConnectionInput
  private generation = 0
  private restoring?: Promise<void>
  private checking = false
  private prompting = false
  private confirming = false
  private remembered = false
  private state: AuthorizationState = 'disconnected'
  private message = '尚未连接 GitHub，可先离线收藏。'
  constructor(queue: CaptureQueue, uploader: CaptureUploader, vault: CredentialVault) { this.queue = queue; this.uploader = uploader; this.vault = vault }
  status(): AuthorizationStatus { return { remembered: this.remembered, state: this.state, message: this.message, backend: this.vault.backend } }
  private set(state: AuthorizationState, message: string): void { this.state = state; this.message = message }
  async prompt(target: CredentialTarget): Promise<string | null> {
    if (this.prompting || this.checking || this.confirming) throw new Error('授权窗口或连接检查已打开，请先完成或取消。')
    this.prompting = true
    const generation = this.generation, previous = { state: this.state, message: this.message }
    this.set('checking', '请在系统授权窗口输入凭证；网页界面不会读取该值。')
    try {
      const token = await this.vault.prompt(target)
      if (generation !== this.generation) return null
      this.set(previous.state, previous.message)
      return token
    } catch (error) {
      if (generation === this.generation) await this.failed(error, undefined)
      throw error
    } finally { this.prompting = false }
  }
  async preflight(input: ConnectionInput): Promise<string> {
    if (this.checking || this.confirming) throw new Error('连接检查正在进行，请稍候。')
    this.generation++; this.checking = true; this.preview = undefined; this.uploader.cancelPreview()
    const generation = this.generation
    this.set('checking', '正在只读核验 GitHub 授权与目标仓库…')
    try {
      const summary = await this.uploader.test(input)
      if (generation !== this.generation) throw new ApiError('aborted')
      const target = this.uploader.previewTarget()
      if (!target) throw new Error('预检已取消，请重试。')
      this.preview = { ...target, token: input.token }
      this.set('checking', '只读检查成功，请确认目标及是否记住此设备。')
      return summary
    } catch (error) {
      if (generation === this.generation) { this.preview = undefined; await this.failed(error, undefined) }
      throw error
    } finally { if (generation === this.generation) this.checking = false }
  }
  async confirm(options: { remember: boolean } = { remember: false }): Promise<string> {
    if (this.confirming || this.checking) throw new Error('连接检查正在进行，请稍候。')
    const preview = this.preview
    if (!preview) throw new Error('请重新执行只读连接检查。')
    this.confirming = true
    const generation = this.generation, oldTarget = this.queue.connection()
    let oldCredential: RememberedCredential | null = null, stored = false
    try {
      // Establish persistence before enabling remembered sessions; restore the old
      // record if the local queue transaction cannot confirm the selected target.
      if (options.remember) {
        oldCredential = await this.vault.read(preview)
        await this.vault.write(preview, preview.token); stored = true
      }
      if (generation !== this.generation) throw new ApiError('aborted')
      const summary = this.uploader.confirm()
      if (!options.remember) await this.vault.remove(preview)
      if (oldTarget && !sameTarget(oldTarget, preview)) await this.vault.remove(oldTarget)
      if (generation !== this.generation) throw new ApiError('aborted')
      this.remembered = options.remember; this.preview = undefined
      this.set('connected', options.remember ? '已连接；Windows 凭证管理器已记住此设备。' : '已连接；仅当前会话使用授权。')
      return summary
    } catch (error) {
      if (stored) {
        try { if (oldCredential && this.queue.connection()) await this.vault.write(oldCredential.target, oldCredential.token); else await this.vault.remove(preview) } catch { /* Fixed state below reports the unavailable vault without leaking secrets. */ }
      }
      this.preview = undefined; this.uploader.cancelPreview()
      if (generation === this.generation) await this.failed(error, undefined)
      throw error
    } finally { if (generation === this.generation) this.confirming = false }
  }
  cancelPreview(): void {
    this.generation++; this.checking = false; this.confirming = false; this.preview = undefined; this.uploader.cancelPreview(); this.vault.cancelPrompt?.()
    this.set(this.uploader.connected() ? 'connected' : 'disconnected', this.uploader.connected() ? '保留原连接，已取消新的授权检查。' : '已取消连接，队列仍在本机。')
  }
  restore(): Promise<void> {
    if (this.uploader.connected() && this.state === 'connected') return Promise.resolve()
    if (this.restoring) return this.restoring
    if (this.prompting || this.checking || this.confirming || this.preview) return Promise.resolve()
    const generation = ++this.generation
    const attempt = this.restoreStored(generation).catch(error => this.failed(error, undefined))
    this.restoring = attempt.finally(() => { if (this.restoring === wrapped) this.restoring = undefined })
    const wrapped = this.restoring
    return wrapped
  }
  private async restoreStored(generation: number): Promise<void> {
    const target = this.queue.connection()
    if (!target) { this.remembered = false; this.set('disconnected', '尚未连接 GitHub，可先离线收藏。'); return }
    this.set('checking', '正在恢复此设备的 GitHub 授权…')
    this.uploader.endSession()
    try {
      const credential = await this.vault.read(target)
      if (generation !== this.generation) return
      if (!credential) { this.remembered = false; this.set('disconnected', '未记住此设备，请在系统窗口输入授权。'); return }
      this.remembered = true
      await this.uploader.test({ ...credential.target, token: credential.token })
      if (generation !== this.generation) { this.uploader.cancelPreview(); return }
      this.uploader.confirm(); this.set('connected', '已自动恢复并验证 GitHub 授权。')
    } catch (error) { if (generation === this.generation) await this.failed(error, target) }
  }
  async disconnect(): Promise<void> {
    const target = this.queue.connection()
    this.generation++; this.preview = undefined; this.checking = false; this.confirming = false
    this.vault.cancelPrompt?.(); this.uploader.disconnect(); this.remembered = false
    this.set('disconnected', '已断开并停止自动连接，队列保留。')
    if (target) {
      try { await this.vault.remove(target) }
      catch { this.set('credential-error', '已停止自动连接，但Windows凭证删除失败；请重试或在Windows凭证管理器移除此应用项。'); throw new CredentialError() }
    }
  }
  async sync(): Promise<string> {
    if (this.state !== 'connected') throw new Error(this.message)
    const generation = this.generation
    try { return await this.uploader.sync() }
    catch (error) { if (generation === this.generation) await this.failed(error, this.remembered ? this.queue.connection() : undefined); throw error }
  }
  endSession(): void { this.generation++; this.preview = undefined; this.checking = false; this.confirming = false; this.vault.cancelPrompt?.(); this.uploader.endSession() }
  private async failed(error: unknown, storedTarget: CredentialTarget | undefined): Promise<void> {
    if (error instanceof ApiError) {
      if (error.code === 'unauthorized') {
        this.uploader.endSession()
        if (storedTarget) {
          try { await this.vault.remove(storedTarget); this.remembered = false }
          catch { this.set('credential-error', '授权已失效，自动连接停止；Windows凭证删除失败，请重新授权或移除此应用凭证。'); return }
        }
        this.set('reauthorize', '授权无效或已到期，请在系统窗口重新授权。'); return
      }
      if (['network', 'timeout', 'server', 'aborted', 'rate-limited'].includes(error.code)) { this.set('offline', '暂时无法连接 GitHub，已保留安全凭证与本机队列；联网后重试。'); return }
      if (error.code === 'forbidden') { this.set('permission-required', '目标仓库或Contents权限不足；安全凭证保留，请检查授权范围。'); return }
      if (error.code === 'not-found') { this.set('not-found', '目标仓库或分支不可访问；凭证保留，未将缺失文件当作凭证失效。'); return }
    }
    if (error instanceof CredentialError) { this.set('credential-error', error.message); return }
    this.set('error', '连接或上传未完成，本机队列保留；请检查目标与版本后重试。')
  }
}

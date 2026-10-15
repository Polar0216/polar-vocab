import { z } from 'zod'
import type { GitHubRepositoryTarget } from './contracts'

export const targetSchema = z.strictObject({ owner: z.string().regex(/^[A-Za-z0-9-]{1,100}$/), repository: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/), branch: z.string().min(1).max(200), path: z.literal('data/state.json') })
export type Target = z.infer<typeof targetSchema>
export type ApiCode = 'unauthorized' | 'forbidden' | 'not-found' | 'sha-conflict' | 'validation' | 'rate-limited' | 'server' | 'network' | 'timeout' | 'aborted' | 'invalid-data' | 'capacity'
const messages: Record<ApiCode, string> = { unauthorized: '授权无效或已到期，请重新授权。', forbidden: '权限或组织策略不允许此操作，请检查 Contents 读写权限。', 'not-found': '仓库、分支或文件不可访问；请检查名称及授权范围。', 'sha-conflict': '远端版本已变化，需要重新读取合并。', validation: 'GitHub 拒绝请求，请检查分支规则和请求格式。', 'rate-limited': 'GitHub 已限流，请等待后重试。', server: 'GitHub 暂时不可用，已保留本机修改。', network: '网络请求未确认，请联网后重试。', timeout: '请求超时，写入结果可能尚未确认。', aborted: '请求已中断，本机修改保留。', 'invalid-data': '远端响应格式不正确，已停止同步。', capacity: '快照超过安全容量，已阻止上传；请导出完整备份。' }
export class ApiError extends Error {
  readonly code: ApiCode; readonly retryAt: number; readonly uncertain: boolean
  constructor(code: ApiCode, retryAt = 0, uncertain = false) { super(messages[code]); this.name = 'ApiError'; this.code = code; this.retryAt = retryAt; this.uncertain = uncertain }
}
export interface RemoteFile { text: string; sha: string; etag?: string }
export interface GitHubTransport { verify(input: Omit<Target, 'branch'> & { branch: string }): Promise<Target>; get(target: Target): Promise<RemoteFile | null>; put(target: Target, text: string, sha: string | null): Promise<RemoteFile>; clear(): void }
const shaSchema = z.string().regex(/^[0-9a-f]{40}$/i)
export const MAX_REMOTE_BYTES = 900_000
export const WARN_REMOTE_BYTES = 720_000
export function utf8Size(text: string): number { return new TextEncoder().encode(text).length }
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}
export function fromBase64(text: string): string { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(text.replace(/\s/g, '')), (c) => c.charCodeAt(0))) }

/** Credentials never cross the storage boundary. Error bodies are classified, never displayed. */
export class GitHubClient implements GitHubTransport {
  #token: string
  private readonly fetcher: typeof fetch
  private readonly timeout: number
  private cache = new Map<string, RemoteFile>()
  private verified = new Set<string>()
  private controllers = new Set<AbortController>()
  constructor(token: string, fetcher: typeof fetch = fetch, timeout = 20_000) { this.#token = token.trim(); this.fetcher = fetcher.bind(globalThis); this.timeout = timeout }
  clear(): void { this.#token = ''; this.cache.clear(); this.verified.clear(); for (const controller of this.controllers) controller.abort() }
  private repo(target: GitHubRepositoryTarget): string { return `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}` }
  private key(target: Target): string { return JSON.stringify(target) }
  private async request(path: string, method = 'GET', body?: unknown, etag?: string): Promise<Response> {
    if (!this.#token) throw new ApiError('unauthorized')
    const controller = new AbortController(); this.controllers.add(controller)
    let timedOut = false
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const timer = setTimeout(() => { timedOut = true; controller.abort(); void reader?.cancel().catch(() => undefined) }, this.timeout)
    try {
      let response = await this.fetcher(`https://api.github.com${path}`, { method, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.#token}`, 'X-GitHub-Api-Version': '2026-03-10', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(etag ? { 'If-None-Match': etag } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
      if (response.status !== 304 && response.body) {
        // Include response-body stalls in the timeout and cap hostile JSON before parsing.
        reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0
        while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; if (bytes > 2_000_000) { await reader.cancel(); throw new ApiError('capacity', 0, method === 'PUT') } chunks.push(chunk.value) }
        if (timedOut) throw new ApiError('timeout', 0, method === 'PUT')
        const content = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.length }
        response = new Response(content, { status: response.status, headers: response.headers })
      }
      if (response.ok || response.status === 304) return response
      let message = ''
      try { const raw: unknown = await response.json(); if (raw && typeof raw === 'object' && 'message' in raw) message = String(raw.message).toLowerCase() } catch { /* Classify by status only. */ }
      const status = response.status
      const limited = status === 429 || [403, 422].includes(status) && (response.headers.get('x-ratelimit-remaining') === '0' || /rate limit|secondary|abuse|spam/.test(message))
      const retry = response.headers.get('retry-after')
      const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000
      const retryAt = Math.max(Date.now() + 60_000, retry ? /^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry) || 0 : 0, reset || 0)
      const code: ApiCode = limited ? 'rate-limited' : status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 404 ? 'not-found' : status === 409 ? 'sha-conflict' : status === 422 ? 'validation' : status >= 500 ? 'server' : 'invalid-data'
      if (code === 'unauthorized') this.clear()
      throw new ApiError(code, limited ? retryAt : 0, method === 'PUT' && status >= 500)
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(controller.signal.aborted ? timedOut ? 'timeout' : 'aborted' : 'network', 0, method === 'PUT')
    } finally { clearTimeout(timer); this.controllers.delete(controller) }
  }
  private async json(response: Response): Promise<Record<string, unknown>> {
    try { return z.record(z.string(), z.unknown()).parse(await response.json()) } catch { throw new ApiError('invalid-data') }
  }
  async verify(input: Omit<Target, 'branch'> & { branch: string }): Promise<Target> {
    const provisional = targetSchema.parse({ ...input, branch: input.branch || 'main' })
    const repo = await this.json(await this.request(this.repo(provisional)))
    if (repo.private !== true) throw new ApiError('forbidden')
    // A redirect or renamed repository is not silently accepted as a different destination.
    if (String(repo.full_name).toLowerCase() !== `${input.owner}/${input.repository}`.toLowerCase()) throw new ApiError('not-found')
    const target = targetSchema.parse({ ...input, branch: input.branch || repo.default_branch })
    await this.request(`${this.repo(target)}/branches/${encodeURIComponent(target.branch)}`)
    // Contents read permission is checked separately from repository metadata access.
    await this.request(`${this.repo(target)}/contents?ref=${encodeURIComponent(target.branch)}`)
    this.verified.add(this.key(target)); return target
  }
  async get(target: Target): Promise<RemoteFile | null> {
    targetSchema.parse(target)
    const key = this.key(target); const cached = this.cache.get(key)
    let response: Response
    try { response = await this.request(`${this.repo(target)}/contents/${target.path}?ref=${encodeURIComponent(target.branch)}`, 'GET', undefined, cached?.etag) }
    catch (error) { if (error instanceof ApiError && error.code === 'not-found' && this.verified.has(key)) {
      // Recheck access and branch at every missing-file response, including deleted repos.
      await this.verify(target); this.cache.delete(key); return null
    } throw error }
    if (response.status === 304) { if (!cached) throw new ApiError('invalid-data'); return cached }
    const raw = await this.json(response)
    if (raw.type !== 'file' || typeof raw.size !== 'number' || raw.size > MAX_REMOTE_BYTES) throw new ApiError(raw.size && Number(raw.size) > MAX_REMOTE_BYTES ? 'capacity' : 'invalid-data')
    if (raw.encoding !== 'base64' || typeof raw.content !== 'string' || raw.path !== target.path) throw new ApiError('invalid-data')
    if (raw.content.length > MAX_REMOTE_BYTES * 1.5) throw new ApiError('capacity')
    try {
      const text = fromBase64(raw.content)
      if (utf8Size(text) > MAX_REMOTE_BYTES) throw new ApiError('capacity')
      const file = { text, sha: shaSchema.parse(raw.sha), etag: response.headers.get('etag') ?? undefined }
      this.cache.set(key, file); return file
    } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError('invalid-data') }
  }
  async put(target: Target, text: string, sha: string | null): Promise<RemoteFile> {
    targetSchema.parse(target)
    if (!this.verified.has(this.key(target))) throw new ApiError('forbidden')
    if (utf8Size(text) > MAX_REMOTE_BYTES) throw new ApiError('capacity')
    if (sha) shaSchema.parse(sha)
    const response = await this.request(`${this.repo(target)}/contents/${target.path}`, 'PUT', { branch: target.branch, message: 'Polar Vocab: synchronize snapshot', content: toBase64(text), ...(sha ? { sha } : {}) })
    const raw = await this.json(response)
    try { const file = { text, sha: shaSchema.parse(z.record(z.string(), z.unknown()).parse(raw.content).sha) }; this.cache.delete(this.key(target)); return file } catch { throw new ApiError('invalid-data', 0, true) }
  }
}

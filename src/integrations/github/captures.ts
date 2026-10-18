import { z } from 'zod'
import { batchPath, decodeBatch, encodeBatch, isBatchPath, MAX_BATCH_BYTES, type CaptureBatch } from '../../../packages/shared/capture-batch'
import { ApiError, fromBase64, toBase64, utf8Size, type Target } from './client'

interface CapturePort { verify(): Promise<unknown>; request(path: string, method?: 'GET' | 'PUT', body?: unknown): Promise<Response> }
const sha = z.string().regex(/^[0-9a-f]{40}$/i)
const descriptor = z.object({ path: z.string(), sha, type: z.string(), size: z.number().optional() })
export interface CaptureFile { path: string; sha: string; size: number }
export class CaptureRepositoryError extends Error {
  readonly code: 'incomplete' | 'collision' | 'invalid'
  constructor(code: 'incomplete' | 'collision' | 'invalid') {
    super({ incomplete: '采集列表被截断或超过本次扫描预算，不能视为完整列表。请保留资料并分批处理。', collision: '同一批次路径已有不同内容，已停止上传，未覆盖远端。', invalid: '采集文件或协议不合法，未导入。' }[code])
    this.code = code
  }
}

/** Capability used by Desktop and Web. PUT is create-only and restricted to captures/. */
export class CaptureRepository {
  private readonly root: string
  readonly target: Target
  private readonly port: CapturePort
  constructor(target: Target, port: CapturePort) { this.target = target; this.port = port; this.root = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repository)}` }
  async scan(): Promise<CaptureFile[]> {
    await this.port.verify()
    const branch = z.object({ commit: z.object({ commit: z.object({ tree: z.object({ sha }) }) }) }).parse(await (await this.port.request(`${this.root}/branches/${encodeURIComponent(this.target.branch)}`)).json())
    const raw = z.object({ truncated: z.boolean(), tree: z.array(descriptor).max(20_000) }).parse(await (await this.port.request(`${this.root}/git/trees/${branch.commit.commit.tree.sha}?recursive=1`)).json())
    if (raw.truncated) throw new CaptureRepositoryError('incomplete')
    const files: CaptureFile[] = []
    for (const file of raw.tree) {
      if (!file.path.startsWith('captures/') || file.type !== 'blob') continue
      if (!isBatchPath(file.path) || !Number.isSafeInteger(file.size) || file.size! > MAX_BATCH_BYTES) throw new CaptureRepositoryError('invalid')
      files.push({ path: file.path, sha: file.sha, size: file.size! })
    }
    if (files.length > 2_000) throw new CaptureRepositoryError('incomplete')
    return files.sort((a, b) => a.path.localeCompare(b.path))
  }
  private async read(path: string): Promise<{ batch: CaptureBatch; sha: string } | null> {
    if (!isBatchPath(path)) throw new CaptureRepositoryError('invalid')
    let response: Response
    try { response = await this.port.request(`${this.root}/contents/${path}?ref=${encodeURIComponent(this.target.branch)}`) }
    catch (error) { if (error instanceof ApiError && error.code === 'not-found') { await this.port.verify(); return null } throw error }
    try {
      const raw = z.object({ type: z.literal('file'), path: z.literal(path), encoding: z.literal('base64'), content: z.string().max(MAX_BATCH_BYTES * 1.5), size: z.number().nonnegative().max(MAX_BATCH_BYTES), sha }).parse(await response.json())
      return { batch: decodeBatch(fromBase64(raw.content), path), sha: raw.sha }
    } catch { throw new CaptureRepositoryError('invalid') }
  }
  async download(file: CaptureFile): Promise<CaptureBatch> {
    await this.port.verify()
    const current = await this.read(file.path)
    if (!current || current.sha !== file.sha) throw new CaptureRepositoryError('invalid')
    return current.batch
  }
  async upload(batch: CaptureBatch): Promise<string> {
    const text = encodeBatch(batch), path = batchPath(batch)
    await this.port.verify()
    const existing = await this.read(path)
    if (existing) {
      if (encodeBatch(existing.batch) !== text) throw new CaptureRepositoryError('collision')
      return existing.sha
    }
    try {
      const response = await this.port.request(`${this.root}/contents/${path}`, 'PUT', {
        branch: this.target.branch, message: 'Polar Vocab: collect immutable capture batch', content: toBase64(text),
      })
      const result = z.object({ content: z.object({ sha }) }).parse(await response.json())
      return result.content.sha
    } catch (error) {
      // A concurrent create or lost response can have committed the exact file.
      if (error instanceof ApiError && ['sha-conflict', 'validation'].includes(error.code)) {
        const found = await this.read(path)
        if (found && encodeBatch(found.batch) === text) return found.sha
        if (found) throw new CaptureRepositoryError('collision')
      }
      throw error
    }
  }
}

export function capturePreviewBudget(batches: readonly CaptureBatch[]): void {
  if (batches.length > 20 || batches.reduce((count, batch) => count + batch.events.length, 0) > 500 || batches.reduce((count, batch) => count + utf8Size(encodeBatch(batch)), 0) > 2_000_000) {
    throw new Error('本次最多预览20批、500个事件、2MB，请减少选择；未导入任何内容。')
  }
}

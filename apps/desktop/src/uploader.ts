import { canonicalJson } from '../../../packages/shared'
import { ApiError, GitHubClient, type Target } from '../../../src/integrations/github/client'
import { CaptureRepositoryError, type CaptureRepository } from '../../../src/integrations/github/captures'
import type { CaptureQueue } from './queue'

export class CaptureUploader {
  private client?: GitHubClient
  private repository?: CaptureRepository
  private preview?: { client: GitHubClient; repository: CaptureRepository; target: Target }
  private generation = 0
  private nextAttempt = 0
  syncing = false
  lastError = ''
  private readonly queue: CaptureQueue
  private readonly fetcher: typeof fetch
  constructor(queue: CaptureQueue, fetcher: typeof fetch = fetch) { this.queue = queue; this.fetcher = fetcher }
  connected(): boolean { return Boolean(this.repository) }
  async test(input: { owner: string; repository: string; branch: string; token: string }): Promise<string> {
    if (this.syncing) throw new Error('上传期间不能切换连接，请等待。')
    this.preview?.client.clear(); this.preview = undefined
    const client = new GitHubClient(input.token, this.fetcher)
    try {
      const target = await client.verify({ owner: input.owner, repository: input.repository, branch: input.branch, path: 'data/state.json' })
      const repository = await client.captures(target)
      this.preview = { client, repository, target }
      return `${target.owner}/${target.repository} · ${target.branch}`
    } catch (error) { client.clear(); throw error }
  }
  confirm(): string {
    if (this.syncing) throw new Error('上传期间不能切换连接，请等待。')
    const plan = this.preview
    if (!plan) throw new Error('请重新执行只读连接测试。')
    this.client?.clear(); this.client = plan.client; this.repository = plan.repository; this.preview = undefined; this.generation++
    this.queue.setConnection({ owner: plan.target.owner, repository: plan.target.repository, branch: plan.target.branch })
    this.nextAttempt = 0; this.lastError = ''
    return `${plan.target.owner}/${plan.target.repository} · ${plan.target.branch}`
  }
  disconnect(): void { this.generation++; this.client?.clear(); this.preview?.client.clear(); this.client = undefined; this.repository = undefined; this.preview = undefined; this.queue.setConnection(undefined); this.lastError = '' }
  cancelPreview(): void { this.preview?.client.clear(); this.preview = undefined }
  endSession(): void { this.generation++; this.client?.clear(); this.preview?.client.clear(); this.client = undefined; this.repository = undefined; this.preview = undefined }
  async sync(): Promise<string> {
    if (this.syncing) throw new Error('已有上传正在进行，请等待。')
    const repository = this.repository, generation = this.generation
    if (!repository) throw new Error('请先测试并确认连接；重启后需要重新输入凭证。')
    if (Date.now() < this.nextAttempt) throw new Error('请等待当前退避时间结束后重试；队列仍在本机。')
    const targetKey = canonicalJson({ owner: repository.target.owner, repository: repository.target.repository, branch: repository.target.branch })
    this.syncing = true; this.lastError = ''
    let sent = 0
    try {
      // Bounded work per trigger; captures added during a batch are a later batch.
      for (let index = 0; index < 10; index++) {
        if (generation !== this.generation || repository !== this.repository) throw new Error('连接已变化，未确认的批次保留。')
        const job = this.queue.freeze(targetKey)
        if (!job) break
        this.queue.uploading(job.batch)
        try {
          const sha = await repository.upload(job.batch)
          if (generation !== this.generation || repository !== this.repository) throw new Error('连接已变化，上传结果留待原目标重试确认。')
          this.queue.acknowledge(job.batch, sha); sent += job.batch.events.length
        } catch (error) {
          const code = error instanceof ApiError ? error.code : error instanceof CaptureRepositoryError ? error.code : 'storage-or-interrupted'
          this.queue.fail(job.batch, code, ['collision', 'invalid', 'invalid-data', 'validation', 'forbidden'].includes(code))
          if (error instanceof ApiError) {
            this.nextAttempt = Math.max(error.retryAt, Date.now() + 60_000)
            if (error.code === 'unauthorized') { this.client?.clear(); this.repository = undefined }
          }
          throw error
        }
      }
      return `已确认上传 ${sent} 条采集事件。`
    } catch (error) { this.lastError = error instanceof ApiError || error instanceof CaptureRepositoryError ? error.message : error instanceof Error ? error.message : '上传未确认，队列保留。'; throw error }
    finally { this.syncing = false }
  }
}

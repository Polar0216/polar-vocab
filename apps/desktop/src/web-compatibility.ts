import { z } from 'zod'

export const releaseCapabilitySchema = z.strictObject({
  format: z.literal('polar-vocab-web-release'), version: z.string().regex(/^\d+\.\d+\.\d+$/),
  captureProtocols: z.array(z.number().int()), stateProtocols: z.array(z.number().int()),
  features: z.array(z.string().max(80)).max(20),
})
export interface WebCompatibilityStatus { verified: boolean; version: string; message: string }
/** Public HTTPS, no credentials, no SW cache; failed checks never enable uploads. */
export class WebCompatibility {
  private readonly fetcher: typeof fetch
  private checkedAt = 0
  private current: WebCompatibilityStatus = { verified: false, version: '', message: '尚未核对正式网站，采集上传暂停；本机收藏可用。' }
  constructor(fetcher: typeof fetch = fetch) { this.fetcher = fetcher }
  status(): WebCompatibilityStatus { return { ...this.current } }
  async verify(): Promise<WebCompatibilityStatus> {
    try {
      const response = await this.fetcher('https://polar0216.github.io/polar-vocab/release.json', { signal: AbortSignal.timeout(8000), redirect: 'error', credentials: 'omit', cache: 'no-store' })
      if (!response.ok) throw new Error('unavailable')
      const text = await response.text(); if (text.length > 8000) throw new Error('large')
      const metadata = releaseCapabilitySchema.parse(JSON.parse(text))
      if (![1, 2].every(version => metadata.captureProtocols.includes(version) && metadata.stateProtocols.includes(version)) || !metadata.features.includes('context-morphology')) throw new Error('version')
      this.current = { verified: true, version: metadata.version, message: `正式网站 ${metadata.version} 已支持当前采集协议。` }; this.checkedAt = Date.now()
    } catch { this.checkedAt = 0; this.current = { verified: false, version: '', message: '未能确认正式网站支持当前数据，上传暂停；请联网后重试。队列保留。' } }
    return this.status()
  }
  async require(): Promise<void> {
    if (!this.current.verified || Date.now() - this.checkedAt > 300_000) await this.verify()
    if (!this.current.verified) throw new Error(this.current.message)
  }
}

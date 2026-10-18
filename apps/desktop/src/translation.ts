import { z } from 'zod'
import type { Language } from '../../../packages/shared'
import type { LookupResult } from './contracts'

export interface TranslationProvider { lookup(text: string, lang: Language, signal: AbortSignal): Promise<LookupResult> }
/** Only the documented free GET API. No set/import, keys, email or paid plan. */
export class MyMemoryProvider implements TranslationProvider {
  private readonly fetcher: typeof fetch
  private readonly timeout: number
  constructor(fetcher: typeof fetch = fetch, timeout = 10_000) { this.fetcher = fetcher; this.timeout = timeout }
  async lookup(text: string, lang: Language, signal: AbortSignal): Promise<LookupResult> {
    if (!text.trim() || new TextEncoder().encode(text).length > 500) throw new Error('免费查询单次最多500个UTF-8字节，请缩短原文或手动填写释义。')
    const controller = new AbortController()
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const cancel = () => { controller.abort(); void reader?.cancel().catch(() => undefined) }
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) controller.abort()
    const timer = setTimeout(cancel, this.timeout)
    try {
      const url = new URL('https://api.mymemory.translated.net/get')
      url.search = new URLSearchParams({ q: text, langpair: `${lang}|zh-CN` }).toString()
      const response = await this.fetcher(url, { signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store' })
      if (!response.ok) throw new Error('翻译服务暂不可用或额度已用完，请手动填写，稍后再试。')
      reader = response.body?.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      if (!reader) throw new Error('翻译服务返回空响应。')
      for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 500_000) { await reader.cancel(); throw new Error('翻译响应过大，未使用。') } chunks.push(value) }
      if (controller.signal.aborted) throw new Error('aborted')
      const bytes = new Uint8Array(size); let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      const data = z.object({ responseStatus: z.union([z.number(), z.string()]), responseData: z.object({ translatedText: z.string().trim().min(1).max(4000), match: z.number().min(0).max(1) }), quotaFinished: z.boolean().optional(), matches: z.array(z.object({ segment: z.string().max(20_000), translation: z.string().max(4000), source: z.string().max(100), target: z.string().max(100), match: z.number().min(0).max(1) })).max(100).optional() }).parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
      if (String(data.responseStatus) !== '200' || data.quotaFinished || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE PAIR/i.test(data.responseData.translatedText)) throw new Error('翻译额度不足或语言不支持，请手动填写。')
      const normalized = (value: string) => value.trim().normalize('NFC').toLocaleLowerCase(lang)
      const exact = data.matches?.find(item => normalized(item.segment) === normalized(text) && item.source.split('-')[0] === lang && /^zh(?:-|$)/i.test(item.target) && item.match >= 0.99 && /\p{Script=Han}/u.test(item.translation))
      const candidate = exact?.translation.trim() ?? (data.responseData.match >= 0.99 && /\p{Script=Han}/u.test(data.responseData.translatedText) ? data.responseData.translatedText : '')
      if (!candidate) throw new Error('翻译服务未返回精确匹配的中文候选，请补充短语后重试或手动填写。')
      return { text: candidate, provider: 'mymemory', attribution: 'MyMemory / Translated（机器翻译或翻译记忆候选，请人工核对）' }
    } catch (error) {
      if (controller.signal.aborted) throw new Error(signal.aborted ? '查询已取消。' : '翻译请求超时，请手动填写或重试。', { cause: error })
      if (error instanceof Error && /^(翻译|免费)/.test(error.message)) throw error
      throw new Error('翻译服务暂不可用，请检查网络或手动填写释义。', { cause: error })
    } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel) }
  }
}

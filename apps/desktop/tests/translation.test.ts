import { describe, expect, it } from 'vitest'
import { MyMemoryProvider } from '../src/translation'
import { popupBounds } from '../src/window'
describe('provider adapter (simulated responses)', () => {
  it('queries only explicit EN/DE to Chinese and preserves real candidate text', async () => {
    const urls: URL[] = [], fake: typeof fetch = async (input) => { urls.push(new URL(String(input))); return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: '人工测试候选', match: 1 } })) }
    const provider = new MyMemoryProvider(fake), signal = new AbortController().signal
    for (const lang of ['en', 'de'] as const) expect((await provider.lookup('Prüfwort', lang, signal)).text).toBe('人工测试候选')
    expect(urls.map((url) => url.searchParams.get('langpair'))).toEqual(['en|zh-CN', 'de|zh-CN'])
    expect(urls.every((url) => url.origin === 'https://api.mymemory.translated.net' && !url.searchParams.has('key'))).toBe(true)
  })
  it('rejects excessive UTF-8 bytes and quota/error results without inventing a translation', async () => {
    const provider = new MyMemoryProvider(async () => new Response(JSON.stringify({ responseStatus: 200, quotaFinished: true, responseData: { translatedText: 'MYMEMORY WARNING', match: 1 } })))
    await expect(provider.lookup('ü'.repeat(251), 'de', new AbortController().signal)).rejects.toThrow('500')
    await expect(provider.lookup('example', 'en', new AbortController().signal)).rejects.toThrow('额度')
  })
  it('supports abort, timeouts and unavailable provider while leaving manual editing possible', async () => {
    const hanging: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => { if (init?.signal?.aborted) reject(new Error('aborted')); else init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))) })
    const controller = new AbortController(), provider = new MyMemoryProvider(hanging, 20)
    controller.abort(); await expect(provider.lookup('example', 'en', controller.signal)).rejects.toThrow('取消')
    await expect(provider.lookup('example', 'en', new AbortController().signal)).rejects.toThrow('超时')
    await expect(new MyMemoryProvider(async () => { throw new Error('offline') }).lookup('example', 'en', new AbortController().signal)).rejects.toThrow('网络')
  })
  it('also times out a response body that stops after headers', async () => {
    const provider = new MyMemoryProvider(async () => new Response(new ReadableStream()), 20)
    await expect(provider.lookup('example', 'en', new AbortController().signal)).rejects.toThrow('超时')
  })
  it('uses an exact Chinese match instead of a bad Latin candidate, and refuses unrelated fuzzy Chinese', async () => {
    const provider = new MyMemoryProvider(async () => Response.json({ responseStatus: 200, responseData: { translatedText: 'mini', match: 1 }, matches: [{ segment: 'Haus', translation: '住宅', source: 'de-DE', target: 'zh-CN', match: 1 }] }))
    expect((await provider.lookup('Haus', 'de', new AbortController().signal)).text).toBe('住宅')
    const fuzzy = new MyMemoryProvider(async () => Response.json({ responseStatus: 200, responseData: { translatedText: '不相关长句', match: 0.4 } }))
    await expect(fuzzy.lookup('das Haus', 'de', new AbortController().signal)).rejects.toThrow('精确匹配')
  })
})
describe('monitor positioning (simulated geometry)', () => {
  it('clamps windows to monitors with negative coordinates and small work areas', () => {
    expect(popupBounds({ x: -5, y: -5 }, { x: -1920, y: -1080, width: 1920, height: 1080 })).toEqual({ x: -600, y: -800, width: 600, height: 800 })
    expect(popupBounds({ x: 900, y: 800 }, { x: 0, y: 0, width: 400, height: 500 })).toEqual({ x: 0, y: 0, width: 400, height: 500 })
  })
})

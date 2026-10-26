import type { Language } from '../../../packages/shared'
import { translationChunks } from './text-analysis'
import { MyMemoryProvider, type TranslationProvider } from './translation'

export interface SentencePart { start: number; end: number; translation?: string; state: 'waiting' | 'translated' | 'failed' }
export interface SentenceTranslation { text: string; complete: boolean; parts: SentencePart[]; attribution: string; warning: string }
export class SentenceTranslator {
  private readonly provider: TranslationProvider
  private readonly deadline: number
  constructor(provider: TranslationProvider = new MyMemoryProvider(), deadline = 30_000) { this.provider = provider; this.deadline = deadline }
  async translate(text: string, lang: Language, signal: AbortSignal, progress: (value: SentenceTranslation) => void = () => undefined): Promise<SentenceTranslation> {
    if (!text.trim() || text.length > 5000) throw new Error('整句翻译限5000字符，请缩短所选文本或手动填写译文。')
    const chunks = translationChunks(text, lang)
    if (chunks.length > 40) throw new Error('所选文本超过免费翻译批次预算，请选择较短段落。')
    const parts: SentencePart[] = chunks.map(chunk => ({ start: chunk.start, end: chunk.end, state: 'waiting' })), controller = new AbortController()
    const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
    const timer = setTimeout(abort, this.deadline)
    const snapshot = (): SentenceTranslation => ({ text: parts.map(part => part.translation ?? '').join('\n'), complete: parts.every(part => part.state === 'translated'), parts: structuredClone(parts), attribution: 'MyMemory / Translated（中文候选，需核对）', warning: parts.some(part => part.state === 'failed') ? '部分翻译失败，原文与已取得译文保留；可手动补充。' : parts.some(part => part.state === 'waiting') ? '正在异步翻译；可继续选词。' : '' })
    try {
      for (let offset = 0; offset < chunks.length; offset += 2) {
        await Promise.all(chunks.slice(offset, offset + 2).map(async (chunk, index) => {
          const part = parts[offset + index]
          if (controller.signal.aborted) { part.state = 'failed'; return }
          try { part.translation = (await this.provider.lookup(chunk.text, lang, controller.signal)).text; part.state = 'translated' }
          catch { part.state = 'failed' }
        }))
        if (signal.aborted) throw new Error('查询已取消。')
        progress(snapshot())
      }
      return snapshot()
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
  }
}

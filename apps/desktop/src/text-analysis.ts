import type { Language } from '../../../packages/shared'

export type QueryMode = 'word' | 'phrase' | 'sentence'
export interface TextToken { text: string; start: number; end: number; word: boolean }
/** Segment offsets always refer to the unchanged UTF-16 source string. */
export function tokenize(text: string, lang: Language): TextToken[] {
  return [...new Intl.Segmenter(lang, { granularity: 'word' }).segment(text)].map(item => ({ text: item.segment, start: item.index, end: item.index + item.segment.length, word: Boolean(item.isWordLike && /\p{L}/u.test(item.segment)) }))
}
export function isSingleWord(text: string): boolean {
  return /^[\p{L}\p{M}\p{N}]+(?:['’\-‐‑][\p{L}\p{M}\p{N}]+)*\.?$/u.test(text.trim()) || /^(?:\p{L}\.){2,}$/u.test(text.trim())
}
/** A suggestion, never an identity or morphology algorithm; UI can override it. */
export function classifyText(text: string, lang: Language): QueryMode {
  const value = text.trim()
  if (!value || isSingleWord(value)) return 'word'
  const words = tokenize(value, lang).filter(token => token.word)
  if (/\n|[!?。！？]/u.test(value) || /[.。]\s*$/u.test(value) && words.length > 1) return 'sentence'
  if (words.length >= 3 && (/^(?:I|you|he|she|we|they|it|there|ich|du|er|sie|es|wir|ihr|man)\b/iu.test(value) || /\b(?:is|are|was|were|has|have|had|will|would|can|could|should|does|did|ist|sind|war|waren|hat|haben|wird|werden|kann|können)\b/iu.test(value))) return 'sentence'
  return 'phrase'
}

/** Free API requests are <=500 UTF-8 bytes and contain a single paragraph. */
export function translationChunks(text: string, lang: Language): { start: number; end: number; text: string }[] {
  const chunks: { start: number; end: number; text: string }[] = [], bytes = (value: string) => new TextEncoder().encode(value).length
  for (const match of text.matchAll(/[^\r\n]+/gu)) {
    const paragraph = match[0], base = match.index
    let current = '', start = base
    const flush = () => { if (current.trim()) chunks.push({ start, end: start + current.length, text: current }); current = '' }
    for (const segment of new Intl.Segmenter(lang, { granularity: 'word' }).segment(paragraph)) {
      if (bytes(segment.segment) > 500) throw new Error('一个连续词超过免费翻译长度，请手动填写译文或选择较短文本。')
      if (bytes(current + segment.segment) > 500) { flush(); start = base + segment.index }
      if (!current) start = base + segment.index
      current += segment.segment
    }
    flush()
  }
  return chunks
}

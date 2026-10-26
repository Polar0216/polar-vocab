import { describe, expect, it } from 'vitest'
import { classifyText, isSingleWord, tokenize, translationChunks } from '../src/text-analysis'
import { SentenceTranslator } from '../src/sentence'

describe('unified text modes and lossless interactive words', () => {
  it('classifies words/phrases/sentences using punctuation and grammar hints, with Unicode intact', () => {
    for (const word of ['Häuser', 'well-known', "can't", 'e.g.', 'Straße', 'Prüfwort']) expect(isSingleWord(word)).toBe(true)
    expect(classifyText('in fact', 'en')).toBe('phrase'); expect(classifyText('auf jeden Fall', 'de')).toBe('phrase')
    expect(classifyText('He went home', 'en')).toBe('sentence'); expect(classifyText('Die Häuser sind groß.', 'de')).toBe('sentence')
    const source = '  “Mr. O’Neill persevered—trotz Schwierigkeiten!” 👋\r\nHäuser, ging.  '
    const tokens = tokenize(source, 'de')
    expect(tokens.map(item => item.text).join('')).toBe(source)
    for (const item of tokens) expect(source.slice(item.start, item.end)).toBe(item.text)
    expect(tokens.filter(item => item.word).map(item => item.text)).toContain('Häuser')
  })
  it('bounds API chunks by bytes and paragraph without reordering or cutting a Unicode word', () => {
    const source = 'Häuser '.repeat(100) + '\n' + 'An artificial paragraph. '.repeat(30)
    const chunks = translationChunks(source, 'de')
    expect(chunks.every(chunk => new TextEncoder().encode(chunk.text).length <= 500 && !chunk.text.includes('\n'))).toBe(true)
    for (const chunk of chunks) expect(source.slice(chunk.start, chunk.end)).toBe(chunk.text)
    expect(chunks.map(chunk => chunk.text).join('')).toBe(source.replace('\n', ''))
    expect(() => translationChunks('ü'.repeat(300), 'de')).toThrow('连续词')
  })
})
describe('sentence MT orchestration (artificial provider only)', () => {
  it('keeps partial results, original offsets and a failed provider editable', async () => {
    const translator = new SentenceTranslator({ lookup: async text => { if (text.includes('bad')) throw new Error('fixture'); return { text: '人工中译', provider: 'mymemory', attribution: 'fixture' } } })
    const result = await translator.translate('Good sentence.\nbad sentence.', 'en', new AbortController().signal)
    expect(result.complete).toBe(false); expect(result.parts.map(part => part.state)).toEqual(['translated', 'failed']); expect(result.text).toContain('人工中译')
  })
  it('can cancel and times out without throwing away completed chunks', async () => {
    const translator = new SentenceTranslator({ lookup: (_text, _lang, signal) => new Promise((_resolve, reject) => { if (signal.aborted) reject(new Error('aborted')); else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }) }) }, 5)
    const result = await translator.translate('Artificial sentence.', 'en', new AbortController().signal)
    expect(result.complete).toBe(false); expect(result.parts[0].state).toBe('failed')
    const controller = new AbortController(), query = translator.translate('Artificial sentence.', 'en', controller.signal); controller.abort()
    await expect(query).rejects.toThrow('取消')
  })
})

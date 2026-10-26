import { describe, expect, it, vi } from 'vitest'
import { DictionaryLookup, WiktApiProvider, type DictionaryProvider } from '../src/dictionary'
import { cleanLexicon, editSense, emptyLexicon, lexiconSchema, manualSense, mergeLexicon, senseMeanings } from '../../../packages/shared'
import type { TranslationProvider } from '../src/translation'

const signal = () => new AbortController().signal
function fake(lang = 'en', brokenForms = false): typeof fetch {
  return async input => {
    const url = String(input)
    if (url.includes('/definitions')) return Response.json({ word: lang === 'en' ? 'test' : 'Haus', edition: 'en', definitions: [
      { pos: 'noun', lang_code: lang, senses: [{ glosses: ['an artificial test'], tags: lang === 'de' ? ['neuter'] : [], examples: [{ text: 'An artificial test.', type: 'example' }, { text: 'Excluded quote', ref: 'Copyrighted book', type: 'quotation' }] }, { glosses: ['another artificial test'] }] },
      { pos: 'verb', lang_code: lang, senses: [{ glosses: ['to test something'] }] },
    ] })
    if (url.includes('/forms')) return brokenForms ? Response.json({}, { status: 503 }) : Response.json({ word: lang === 'en' ? 'test' : 'Haus', edition: 'en', forms: [
      { pos: 'noun', lang_code: lang, forms: [{ form: 'Häuser', tags: ['plural'] }] },
      { pos: 'verb', lang_code: lang, forms: [{ form: 'gehen', tags: ['infinitive'] }, { form: 'ging', tags: ['past'] }, { form: 'gegangen', tags: ['participle', 'past'] }, { form: 'gehe', tags: ['present', 'indicative', 'singular', 'first-person'] }] },
    ] })
    return Response.json({ word: lang === 'en' ? 'test' : 'Haus', edition: 'en', pronunciations: [{ lang_code: lang, sounds: [{ ipa: null }, { ipa: '/test/' }] }] })
  }
}
const translated: TranslationProvider = { lookup: async text => ({ text: '中文：' + text, provider: 'mymemory', attribution: 'Artificial fixture' }) }

describe('dictionary adapters (artificial responses, no external network)', () => {
  it('retains multiple POS and senses, pronunciation and only licensed usage examples', async () => {
    const provider = new WiktApiProvider(fake()), a = await provider.lookup('test', 'en', signal()), b = await provider.lookup('test', 'en', signal())
    expect(a.lexicon.senses.map(item => item.partOfSpeech)).toEqual(['noun', 'verb', 'noun'])
    expect(a.lexicon.senses.map(item => item.id)).toEqual(b.lexicon.senses.map(item => item.id))
    expect(a.lexicon.senses[0].examples.map(item => item.text)).toEqual(['An artificial test.'])
    expect(a.lexicon.phonetic).toBe('/test/'); expect(a.lexicon.senses[0].sources.definition.license).toBe('CC-BY-SA-4.0')
    expect(lexiconSchema.safeParse(a.lexicon).success).toBe(true)
  })
  it('maps explicit German gender, plural and verb forms without suffix inference', async () => {
    const result = await new WiktApiProvider(fake('de')).lookup('Haus', 'de', signal())
    expect(result.de).toMatchObject({ article: 'das', plural: 'Häuser', infinitive: 'gehen', past: 'ging', participleII: 'gegangen', conjugations: [{ tense: 'Präsens', person: 'ich', form: 'gehe' }] })
    expect(result.lexicon.fieldSources['de.article'].provider).toBe('wiktionary')
  })
  it('keeps partial definitions when forms fail and does not invent fields', async () => {
    const result = await new WiktApiProvider(fake('de', true)).lookup('Haus', 'de', signal())
    expect(result.de?.plural).toBeUndefined(); expect(result.de?.infinitive).toBeUndefined()
    expect(result.warnings).toContain('词形查询失败，未推断词形。'); expect(result.lexicon.senses).toHaveLength(3)
    const minimal = new WiktApiProvider(async () => Response.json({ word: 'test', edition: 'en', definitions: [{ lang_code: 'en', senses: [{ glosses: ['artificial'] }] }] }))
    expect((await minimal.lookup('test', 'en', signal())).lexicon.senses[0].partOfSpeech).toBeUndefined()
  })
  it('rejects mismatched languages/words and malformed, oversized or failed API responses', async () => {
    await expect(new WiktApiProvider(fake()).lookup('other', 'en', signal())).rejects.toThrow('原词不一致')
    await expect(new WiktApiProvider(async () => Response.json({}, { status: 429 })).lookup('test', 'en', signal())).rejects.toThrow('限流')
    await expect(new WiktApiProvider(async () => new Response('x'.repeat(2_000_001))).lookup('test', 'en', signal())).rejects.toThrow('安全大小')
    await expect(new WiktApiProvider(fake()).lookup('test', 'de', signal())).rejects.toThrow('没有可用义项')
  })
  it('enforces timeout and user cancellation during body reads', async () => {
    const slow: typeof fetch = async (_input, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    await expect(new WiktApiProvider(slow, 5).lookup('test', 'en', signal())).rejects.toThrow('超时')
    const controller = new AbortController(), query = new WiktApiProvider(slow).lookup('test', 'en', controller.signal)
    controller.abort(); await expect(query).rejects.toThrow('取消')
  })
  it('shows dictionary data before MT, translates each gloss separately, and reuses translations', async () => {
    const dictionary = new WiktApiProvider(fake()), translate = vi.fn(translated.lookup), lookup = new DictionaryLookup(dictionary, { lookup: translate }), progress = vi.fn()
    const a = await lookup.lookup('test', 'en', signal(), progress), b = await lookup.lookup('test', 'en', signal())
    expect(progress.mock.calls[0][0].lexicon.senses.every((sense: { chinese?: string }) => !sense.chinese)).toBe(true)
    expect(translate).toHaveBeenCalledTimes(3)
    expect(a.lexicon.senses.map(item => item.chinese)).toEqual(['中文：an artificial test', '中文：to test something', '中文：another artificial test'])
    expect(b.lexicon.senses.map(item => item.id)).toEqual(a.lexicon.senses.map(item => item.id))
  })
  it('retains dictionary senses after MT failure; falls back to a POS-free phrase only when dictionary fails', async () => {
    const failing: TranslationProvider = { lookup: async () => { throw new Error('offline') } }
    const partial = await new DictionaryLookup(new WiktApiProvider(fake()), failing).lookup('test', 'en', signal())
    expect(partial.lexicon.senses).toHaveLength(3); expect(senseMeanings(partial.lexicon)).toEqual([]); expect(partial.warnings.join()).toContain('翻译失败')
    const dictionary: DictionaryProvider = { lookup: async () => { throw new Error('offline') } }
    const phrase = await new DictionaryLookup(dictionary, translated).lookup('a phrase', 'en', signal())
    expect(phrase.lexicon.senses[0].partOfSpeech).toBeUndefined(); expect(phrase.lexicon.senses[0].sources.chinese.provider).toBe('mymemory')
    await expect(new DictionaryLookup(dictionary, failing).lookup('test', 'en', signal())).rejects.toThrow('手动添加')
  })
})

describe('stable editing and query reconciliation', () => {
  it('preserves manual fields, additions and deletions across progressive and repeated results', async () => {
    const original = (await new WiktApiProvider(fake()).lookup('test', 'en', signal())).lexicon
    const changed = structuredClone(original), removed = changed.senses.pop()!
    changed.senses[0] = editSense(changed.senses[0], 'chinese', '人工改写')
    changed.senses[0] = editSense(changed.senses[0], 'partOfSpeech', '短语')
    changed.removedSenseIds.push(removed.id)
    const manual = editSense(manualSense(), 'chinese', '新建人工义项'); changed.senses.push(manual)
    const merged = mergeLexicon(changed, { ...original, senses: original.senses.map(item => ({ ...item, chinese: '机器翻译' })) })
    expect(merged.senses).toHaveLength(3); expect(merged.senses[0]).toMatchObject({ id: original.senses[0].id, chinese: '人工改写', partOfSpeech: '短语', sources: { partOfSpeech: { modified: true } } })
    expect(merged.senses.find(sense => sense.id === removed.id)).toBeUndefined(); expect(merged.senses.at(-1)?.id).toBe(manual.id)
    expect(senseMeanings(cleanLexicon(merged))).toContain('人工改写')
    const blank = { ...emptyLexicon(), senses: [manualSense()] }
    expect(cleanLexicon(blank).senses).toHaveLength(0)
  })
})

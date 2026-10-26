import { z } from 'zod'
import { v5 } from 'uuid'
import { emptyLexicon, type Language, type Lexicon, type GermanFields, type FieldSource, type LemmaCandidate } from '../../../packages/shared'
import { MyMemoryProvider, type TranslationProvider } from './translation'
import { dictionaryLemmaCandidates } from './morphology'

const NAMESPACE = 'f7605af7-ce04-58fc-904d-1328c445d779'
const tags = z.array(z.string().max(100)).max(100).optional().default([])
const example = z.object({ text: z.string().max(2000), type: z.string().optional(), translation: z.string().max(2000).optional(), english: z.string().max(2000).optional(), ref: z.string().optional() })
const sense = z.object({ glosses: z.array(z.string().max(4000)).max(20).optional().default([]), tags, examples: z.array(example).max(100).optional().default([]) })
const definitionsSchema = z.object({ word: z.string().max(500), edition: z.literal('en'), definitions: z.array(z.object({ pos: z.string().max(100).optional(), lang_code: z.string(), senses: z.array(sense).max(1000) })).max(100) })
const formsSchema = z.object({ word: z.string(), edition: z.literal('en'), forms: z.array(z.object({ pos: z.string().optional(), lang_code: z.string(), forms: z.array(z.object({ form: z.string().max(500), tags })).max(1000) })).max(100) })

export interface DictionaryResult { lexicon: Lexicon; de?: GermanFields; warnings: string[]; lemmaCandidates?: LemmaCandidate[]; hasIndependentSenses?: boolean }
export interface DictionaryProvider { lookup(text: string, lang: Language, signal: AbortSignal): Promise<DictionaryResult> }
export const wiktionarySource = (text: string, lang: Language): FieldSource => ({ provider: 'wiktionary', url: `https://en.wiktionary.org/wiki/${encodeURIComponent(text)}#${lang === 'en' ? 'English' : 'German'}`, license: 'CC-BY-SA-4.0' })

/** Three documented resources: the full-entry resource currently omits POS. */
export class WiktApiProvider implements DictionaryProvider {
  private readonly fetcher: typeof fetch
  private readonly timeout: number
  constructor(fetcher: typeof fetch = fetch, timeout = 8000) { this.fetcher = fetcher; this.timeout = timeout }
  private async resource(text: string, lang: Language, name: string, signal: AbortSignal): Promise<unknown> {
    const controller = new AbortController(), abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => undefined) }, this.timeout)
    try {
      const response = await this.fetcher(`https://api.wiktapi.dev/v1/en/word/${encodeURIComponent(text)}${name ? '/' + name : ''}?lang=${lang}`, { signal: controller.signal, credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json', 'User-Agent': 'PolarVocabCapture/0.6.0 (+https://github.com/Polar0216/polar-vocab)' } })
      if (!response.ok) throw new Error(response.status === 404 ? '词典未收录，可手动添加义项。' : '词典服务暂不可用或限流，可手动添加义项。')
      reader = response.body?.getReader(); if (!reader) throw new Error('词典响应为空。')
      const chunks: Uint8Array[] = []; let size = 0
      for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) { await reader.cancel(); throw new Error('词典响应超出安全大小。') } chunks.push(value) }
      if (controller.signal.aborted) throw new Error('aborted')
      const bytes = new Uint8Array(size); let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch (error) {
      if (controller.signal.aborted) throw new Error(signal.aborted ? '查询已取消。' : '词典请求超时，可继续手动编辑。', { cause: error })
      if (error instanceof Error && error.message.startsWith('词典')) throw error
      throw new Error('词典服务或数据暂不可用，可继续手动编辑。', { cause: error })
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
  }
  async lookup(text: string, lang: Language, signal: AbortSignal): Promise<DictionaryResult> {
    const word = text.trim().normalize('NFC'), source = wiktionarySource(word, lang)
    const [definitions, forms, pronunciations] = await Promise.allSettled(['definitions', 'forms', 'pronunciations'].map(name => this.resource(word, lang, name, signal)))
    if (signal.aborted) throw new Error('查询已取消。')
    if (definitions.status === 'rejected') throw definitions.reason
    const parsed = definitionsSchema.parse(definitions.value)
    // Case-sensitive headwords matter in German. Never associate a different lemma/language.
    if (parsed.word.normalize('NFC') !== word) throw new Error('词典返回的原词不一致，未采用。')
    const lexicon = emptyLexicon(), warnings: string[] = []
    const entries = parsed.definitions.filter(entry => entry.lang_code === lang)
    // Round-robin avoids dropping later parts of speech on highly polysemous words.
    const groups = entries.map(entry => entry.senses.map(item => ({ ...item, pos: entry.pos })))
    const selected = [] as (typeof groups)[number]
    for (let i = 0; groups.some(group => i < group.length) && selected.length < 64; i++) for (const group of groups) if (group[i] && selected.length < 64) selected.push(group[i])
    if (groups.flat().length > 64) warnings.push('词典义项较多，仅载入前64项（各词性交替）；可访问来源核对。')
    for (const item of selected) {
      const definition = item.glosses.join(' ').trim(); if (!definition) continue
      if (definition.length > 4000) { warnings.push('一个过长义项未载入，请查阅词典来源。'); continue }
      const id = v5(JSON.stringify(['wiktapi', 'en', lang, word, item.pos ?? '', definition]), NAMESPACE)
      if (lexicon.senses.some(sense => sense.id === id)) continue
      lexicon.senses.push({ id, ...(item.pos ? { partOfSpeech: item.pos } : {}), definition, definitionLanguage: 'en',
        sources: { definition: source, ...(item.pos ? { partOfSpeech: source } : {}) },
        // Quoted copyrighted books are excluded; only unreferenced usage examples are copied.
        examples: item.examples.filter(value => value.type === 'example' && !value.ref && value.text.trim()).slice(0, 2).map(value => ({
          id: v5(id + ':' + value.text, NAMESPACE), text: value.text, ...(value.translation || value.english ? { translation: value.translation || value.english, translationLanguage: 'en' as const } : {}), sources: { text: source, ...(value.translation || value.english ? { translation: source } : {}) },
        })),
      })
    }
    if (!lexicon.senses.length) throw new Error('词典没有可用义项，可手动添加。')
    if (forms.status === 'fulfilled') {
      const parsedForms = formsSchema.safeParse(forms.value)
      if (parsedForms.success && parsedForms.data.word.normalize('NFC') === word) for (const group of parsedForms.data.forms.filter(group => group.lang_code === lang)) for (const form of group.forms) {
        if (!form.form.trim() || form.tags.some(tag => ['table-tags', 'inflection-template', 'class'].includes(tag))) continue
        const id = v5(JSON.stringify([lang, word, group.pos, form.form, [...form.tags].sort()]), NAMESPACE)
        if (!lexicon.forms.some(item => item.id === id) && lexicon.forms.length < 160) lexicon.forms.push({ id, form: form.form, partOfSpeech: group.pos, tags: form.tags.slice(0, 20), source })
      }
      else warnings.push('词形数据不完整，保留为空。')
    } else warnings.push('词形查询失败，未推断词形。')
    if (pronunciations.status === 'fulfilled') {
      const parsedSounds = z.object({ word: z.string(), edition: z.literal('en'), pronunciations: z.array(z.object({ lang_code: z.string(), sounds: z.array(z.object({ ipa: z.string().max(200).nullable().optional() })).optional() })) }).safeParse(pronunciations.value)
      const ipa = parsedSounds.success && parsedSounds.data.word.normalize('NFC') === word ? parsedSounds.data.pronunciations.filter(group => group.lang_code === lang).flatMap(group => group.sounds ?? []).find(sound => sound.ipa)?.ipa : undefined
      if (ipa) { lexicon.phonetic = ipa; lexicon.fieldSources.phonetic = source }
    }
    const de: GermanFields = {}
    if (lang === 'de') {
      const assign = (key: 'plural' | 'infinitive' | 'past' | 'participleII', values: string[]) => {
        const unique = [...new Set(values)]; if (unique.length === 1) { de[key] = unique[0]; lexicon.fieldSources['de.' + key] = source }
      }
      const nounEntries = entries.filter(entry => entry.pos === 'noun')
      const genders = [...new Set(nounEntries.flatMap(entry => entry.senses.flatMap(item => item.tags.filter(tag => ['masculine', 'feminine', 'neuter'].includes(tag)))))]
      if (genders.length === 1) { de.article = ({ masculine: 'der', feminine: 'die', neuter: 'das' } as const)[genders[0] as 'masculine' | 'feminine' | 'neuter']; lexicon.fieldSources['de.article'] = source }
      assign('plural', lexicon.forms.filter(form => form.partOfSpeech === 'noun' && form.tags.includes('plural') && !form.tags.some(tag => ['dative', 'genitive', 'accusative'].includes(tag))).map(form => form.form))
      const verbs = lexicon.forms.filter(form => form.partOfSpeech === 'verb')
      assign('infinitive', verbs.filter(form => form.tags.includes('infinitive') && !form.tags.some(tag => ['zu', 'future', 'multiword-construction'].includes(tag))).map(form => form.form))
      assign('past', verbs.filter(form => form.tags.includes('past') && !form.tags.includes('participle') && !form.tags.includes('subjunctive') && !form.tags.includes('plural')).map(form => form.form))
      assign('participleII', verbs.filter(form => form.tags.includes('past') && form.tags.includes('participle')).map(form => form.form))
      const persons = ['first-person', 'second-person', 'third-person']
      de.conjugations = verbs.filter(form => form.tags.includes('present') && form.tags.includes('indicative') && persons.some(person => form.tags.includes(person)) && form.tags.some(tag => ['singular', 'plural'].includes(tag))).slice(0, 6).map(form => ({ tense: 'Präsens', person: (form.tags.includes('plural') ? ['wir', 'ihr', 'sie-Sie'] : ['ich', 'du', 'er-sie-es'])[persons.findIndex(person => form.tags.includes(person))] as NonNullable<GermanFields['conjugations']>[number]['person'], form: form.form }))
      const auxiliaries = [...new Set(verbs.filter(form => form.tags.includes('auxiliary') && ['haben', 'sein'].includes(form.form)).map(form => form.form))]
      if (auxiliaries.length === 1) { de.auxiliary = auxiliaries[0] as 'haben' | 'sein'; lexicon.fieldSources['de.auxiliary'] = source }
      if (de.conjugations.length) lexicon.fieldSources['de.conjugations'] = source; else delete de.conjugations
    }
    let lemmaCandidates: LemmaCandidate[] | undefined
    const hasFormRelations = entries.some(entry => entry.senses.some(sense => sense.tags.some(tag => tag === 'form-of' || tag === 'alt-of')))
    if (hasFormRelations) {
      try {
        const raw = await this.resource(word, lang, '', signal)
        lemmaCandidates = dictionaryLemmaCandidates(word, lang, raw, entries.flatMap(entry => entry.senses.map(sense => ({ ...sense, partOfSpeech: entry.pos }))))
        if (!lemmaCandidates.length) warnings.push('词典未提供可核实的原型关系，保留原词形。')
      } catch {
        if (signal.aborted) throw new Error('查询已取消。')
        warnings.push('原型关系查询失败，当前保留原词形。')
      }
    }
    return { lexicon, ...(lang === 'de' ? { de } : {}), warnings, ...(lemmaCandidates?.length ? { lemmaCandidates, hasIndependentSenses: entries.some(entry => entry.senses.some(sense => !sense.tags.includes('form-of') && !sense.tags.includes('alt-of'))) } : {}) }
  }
}

/** Dictionary arrives first. MT is a separate, bounded, cancellable enrichment. */
export class DictionaryLookup {
  private readonly dictionary: DictionaryProvider
  private readonly translation: TranslationProvider
  private readonly translations = new Map<string, string>()
  constructor(dictionary: DictionaryProvider = new WiktApiProvider(), translation: TranslationProvider = new MyMemoryProvider()) { this.dictionary = dictionary; this.translation = translation }
  async lookup(text: string, lang: Language, signal: AbortSignal, progress: (result: DictionaryResult) => void = () => undefined): Promise<DictionaryResult> {
    let result: DictionaryResult
    try { result = await this.dictionary.lookup(text, lang, signal) }
    catch {
      if (signal.aborted) throw new Error('查询已取消。')
      const lexicon = emptyLexicon()
      try {
        const translated = await this.translation.lookup(text, lang, signal)
        lexicon.senses.push({ id: v5(JSON.stringify(['mymemory-phrase', lang, text.trim().normalize('NFC')]), NAMESPACE), chinese: translated.text, examples: [], sources: { chinese: { provider: 'mymemory', url: 'https://mymemory.translated.net/' } } })
        return { lexicon, warnings: ['词典未返回数据；当前为机器翻译候选，词性与词形留空。'] }
      } catch { if (signal.aborted) throw new Error('查询已取消。'); throw new Error('词典及翻译未返回结果，可继续编辑或手动添加义项。') }
    }
    progress(structuredClone(result))
    // Four glosses, <=500 UTF-8 bytes each, at most two in flight; never translate
    // the lemma once and mislabel that translation as every dictionary sense.
    const candidates = result.lexicon.senses.filter(sense => sense.definition && new TextEncoder().encode(sense.definition).length <= 500).slice(0, 4)
    if (candidates.length < result.lexicon.senses.length) result.warnings.push('自动中文翻译最多4个义项；其他义项可单独翻译或手动补充，避免消耗免费额度。')
    let failed = false
    for (let offset = 0; offset < candidates.length; offset += 2) {
      await Promise.all(candidates.slice(offset, offset + 2).map(async sense => {
        const key = sense.definition!
        try {
          const chinese = this.translations.get(key) ?? (await this.translation.lookup(key, 'en', signal)).text
          if (signal.aborted) return
          if (this.translations.size >= 100) this.translations.delete(this.translations.keys().next().value!)
          this.translations.set(key, chinese); sense.chinese = chinese; sense.sources.chinese = { provider: 'mymemory', url: 'https://mymemory.translated.net/' }
        } catch { failed = true }
      }))
      if (signal.aborted) throw new Error('查询已取消。')
      progress(structuredClone(result))
    }
    if (failed) result.warnings.push('部分中文翻译失败或额度不足；词典义项已保留，可手动编辑。')
    return result
  }
}

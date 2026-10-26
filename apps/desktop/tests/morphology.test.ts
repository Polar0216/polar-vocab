import { describe, expect, it } from 'vitest'
import { dictionaryLemmaCandidates, type MorphologyDefinition } from '../src/morphology'
import { WiktApiProvider } from '../src/dictionary'

const definition = (gloss: string, tags: string[], partOfSpeech = 'verb'): MorphologyDefinition => ({ partOfSpeech, glosses: [gloss], tags })
const full = (word: string, senses: unknown[], rest: object = {}) => ({ word, edition: 'en', entries: [{ senses, ...rest }] })

describe('dictionary-grounded morphology (artificial responses; no network)', () => {
  it.each([
    ['persevered', 'persevere', 'en', ['form-of', 'past', 'participle']],
    ['difficulties', 'difficulty', 'en', ['form-of', 'plural']],
    ['went', 'go', 'en', ['form-of', 'past']],
    ['Häuser', 'Haus', 'de', ['form-of', 'plural', 'nominative']],
    ['ging', 'gehen', 'de', ['form-of', 'preterite', 'singular']],
    ['gegangen', 'gehen', 'de', ['form-of', 'past', 'participle']],
  ] as const)('keeps an explicit %s → %s link and the supplied grammatical tags', (word, lemma, lang, suppliedTags) => {
    const tags = [...suppliedTags], gloss = 'Artificial form relationship'
    const candidates = dictionaryLemmaCandidates(word, lang, full(word, [{ glosses: [gloss], tags, form_of: [{ word: lemma }] }]), [definition(gloss, tags)])
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ lemma, tags: [...tags].sort(), source: { provider: 'wiktionary', license: 'CC-BY-SA-4.0' } })
  })
  it('joins complete gloss+tags rather than entry order and keeps ambiguous lemmas/relationships', () => {
    const a = definition('Artificial primary past', ['past', 'form-of']), b = definition('Artificial rare past', ['past', 'form-of', 'archaic'])
    const raw = { word: 'went', edition: 'en', entries: [{ senses: [{ glosses: b.glosses, tags: [...b.tags], form_of: [{ word: 'wend' }] }] }, { senses: [{ glosses: a.glosses, tags: [...a.tags], form_of: [{ word: 'go' }] }] }] }
    expect(dictionaryLemmaCandidates('went', 'en', raw, [a, b]).map(candidate => candidate.lemma)).toEqual(['wend', 'go'])
    expect(dictionaryLemmaCandidates('went', 'en', raw, [a, b])[0].tags).toContain('archaic')
  })
  it('does not guess from suffixes, English gloss text, wrong languages, wrong words or unconfirmed links', () => {
    expect(dictionaryLemmaCandidates('painted', 'en', full('painted', [{ glosses: ['past of paint'], tags: ['past', 'form-of'] }]), [definition('past of paint', ['past', 'form-of'])])).toEqual([])
    const raw = full('painted', [{ glosses: ['Artificial'], tags: ['past', 'form-of'], form_of: [{ word: 'paint' }] }])
    expect(dictionaryLemmaCandidates('different', 'en', raw, [definition('Artificial', ['past', 'form-of'])])).toEqual([])
    expect(dictionaryLemmaCandidates('painted', 'en', raw, [definition('Other gloss', ['past', 'form-of'])])).toEqual([])
    expect(dictionaryLemmaCandidates('painted', 'en', { ...raw, entries: [{ ...raw.entries[0], lang_code: 'fr' }] }, [definition('Artificial', ['past', 'form-of'])])).toEqual([])
  })
  it('retains explicit alternative forms and removes exact duplicate links without changing spelling', () => {
    const tags = ['alternative', 'alt-of'], raw = full('colour', [{ glosses: ['Artificial alternative'], tags, alt_of: [{ word: 'color' }, { word: 'color' }] }])
    const candidates = dictionaryLemmaCandidates('colour', 'en', raw, [definition('Artificial alternative', tags, 'noun')])
    expect(candidates).toHaveLength(1); expect(candidates[0]).toMatchObject({ lemma: 'color', partOfSpeech: 'noun', tags: ['alt-of', 'alternative'] })
  })
  it('adds relations to the existing provider result without replacing the inflected word senses', async () => {
    const calls: string[] = [], suppliedTags = ['form-of', 'past']
    const fetcher: typeof fetch = async input => {
      const url = String(input); calls.push(url)
      if (url.includes('/definitions')) return Response.json({ word: 'painted', edition: 'en', definitions: [{ lang_code: 'en', pos: 'verb', senses: [{ glosses: ['Artificial past form'], tags: suppliedTags }] }] })
      if (url.includes('/forms')) return Response.json({ word: 'painted', edition: 'en', forms: [] })
      if (url.includes('/pronunciations')) return Response.json({ word: 'painted', edition: 'en', pronunciations: [] })
      return Response.json(full('painted', [{ glosses: ['Artificial past form'], tags: suppliedTags, form_of: [{ word: 'paint' }] }]))
    }
    const result = await new WiktApiProvider(fetcher).lookup('painted', 'en', new AbortController().signal)
    expect(result.lemmaCandidates?.[0].lemma).toBe('paint'); expect(result.hasIndependentSenses).toBe(false)
    expect(result.lexicon.senses[0].definition).toBe('Artificial past form'); expect(calls).toHaveLength(4)
  })
  it('keeps editable dictionary senses if the optional full relation request fails', async () => {
    const fetcher: typeof fetch = async input => {
      const url = String(input)
      if (url.includes('/definitions')) return Response.json({ word: 'painted', edition: 'en', definitions: [{ lang_code: 'en', pos: 'verb', senses: [{ glosses: ['Artificial past form'], tags: ['form-of', 'past'] }] }] })
      return Response.json({}, { status: 503 })
    }
    const result = await new WiktApiProvider(fetcher).lookup('painted', 'en', new AbortController().signal)
    expect(result.lexicon.senses).toHaveLength(1); expect(result.lemmaCandidates).toBeUndefined(); expect(result.warnings.join()).toContain('原型关系查询失败')
  })
})

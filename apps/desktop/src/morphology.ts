import { z } from 'zod'
import type { FieldSource, Language, LemmaCandidate } from '../../../packages/shared'

const linkSchema = z.object({ word: z.string().trim().min(1).max(500) })
const morphSenseSchema = z.object({
  glosses: z.array(z.string().max(4000)).max(20).optional().default([]),
  tags: z.array(z.string().max(100)).max(100).optional().default([]),
  form_of: z.array(linkSchema).max(30).optional().default([]),
  alt_of: z.array(linkSchema).max(30).optional().default([]),
})
const fullWordSchema = z.object({
  word: z.string().max(500), edition: z.literal('en'),
  entries: z.array(z.object({
    word: z.string().max(500).optional(), lang_code: z.string().optional(),
    senses: z.array(morphSenseSchema).max(1000),
  })).max(100),
})

export interface MorphologyDefinition { partOfSpeech?: string; glosses: readonly string[]; tags: readonly string[] }
const identity = (sense: Pick<MorphologyDefinition, 'glosses' | 'tags'>) => JSON.stringify([sense.glosses, [...sense.tags].sort()])

/**
 * The full endpoint retains form_of/alt_of but currently omits entry POS/language.
 * Join by complete gloss+tags to definitions already filtered to the requested
 * language; never join entries by array position or infer a lemma from spelling.
 */
export function dictionaryLemmaCandidates(word: string, lang: Language, raw: unknown, definitions: readonly MorphologyDefinition[]): LemmaCandidate[] {
  const parsed = fullWordSchema.safeParse(raw)
  if (!parsed.success || parsed.data.word.normalize('NFC') !== word.normalize('NFC')) return []
  const source: FieldSource = { provider: 'wiktionary', url: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}#${lang === 'en' ? 'English' : 'German'}`, license: 'CC-BY-SA-4.0' }
  const result: LemmaCandidate[] = [], seen = new Set<string>()
  for (const entry of parsed.data.entries) {
    if (entry.lang_code && entry.lang_code !== lang || entry.word && entry.word.normalize('NFC') !== word.normalize('NFC')) continue
    for (const sense of entry.senses) {
      const matches = definitions.filter(definition => identity(definition) === identity(sense))
      if (!matches.length) continue
      const parts = [...new Set(matches.flatMap(definition => definition.partOfSpeech ? [definition.partOfSpeech] : []))]
      const partOfSpeech = parts.length === 1 ? parts[0] : undefined
      for (const [relation, links] of [['form-of', sense.form_of], ['alt-of', sense.alt_of]] as const) for (const link of links) {
        const lemma = link.word.normalize('NFC')
        if (lemma === word.normalize('NFC')) continue
        const tags = [...new Set([relation, ...sense.tags])].sort().slice(0, 20)
        const key = JSON.stringify([lemma, partOfSpeech ?? '', tags])
        if (seen.has(key) || result.length >= 20) continue
        seen.add(key); result.push({ lemma, ...(partOfSpeech ? { partOfSpeech } : {}), tags, source })
      }
    }
  }
  return result
}

import { z } from 'zod'
import { nonBlankText, uuidSchema } from './common'

/** Provenance survives edits. `modified` means the user changed the sourced value. */
export const fieldSourceSchema = z.strictObject({
  provider: z.enum(['wiktionary', 'mymemory', 'manual', 'legacy']),
  url: z.url({ protocol: /^https$/ }).optional(),
  license: nonBlankText(100).optional(),
  modified: z.boolean().optional(),
})

/** A dictionary-confirmed form relationship, not a locally guessed stem. */
export const lemmaCandidateSchema = z.strictObject({
  lemma: nonBlankText(500),
  partOfSpeech: nonBlankText(100).optional(),
  tags: z.array(nonBlankText(100)).max(20),
  source: fieldSourceSchema,
})
const sourcesSchema = z.record(z.string().min(1).max(100), fieldSourceSchema).refine(value => Object.keys(value).length <= 50)
export const senseExampleSchema = z.strictObject({
  id: uuidSchema, text: nonBlankText(2000), translation: nonBlankText(2000).optional(),
  translationLanguage: z.enum(['en', 'zh-CN']).optional(), sources: sourcesSchema,
})
export const dictionarySenseSchema = z.strictObject({
  id: uuidSchema, partOfSpeech: nonBlankText(100).optional(), chinese: nonBlankText(4000).optional(),
  definition: nonBlankText(4000).optional(), definitionLanguage: z.enum(['en', 'de']).optional(),
  examples: z.array(senseExampleSchema).max(5), sources: sourcesSchema,
})
export const lexiconSchema = z.strictObject({
  schemaVersion: z.literal(1), phonetic: nonBlankText(200).optional(),
  senses: z.array(dictionarySenseSchema).max(64),
  forms: z.array(z.strictObject({ id: uuidSchema, form: nonBlankText(500), partOfSpeech: nonBlankText(100).optional(), tags: z.array(nonBlankText(100)).max(20), source: fieldSourceSchema })).max(160),
  fieldSources: sourcesSchema,
  removedSenseIds: z.array(uuidSchema).max(256),
}).superRefine((value, context) => {
  for (const key of ['senses', 'forms'] as const) {
    if (new Set(value[key].map(item => item.id)).size !== value[key].length) context.addIssue({ code: 'custom', path: [key], message: '结构化记录 ID 不可重复' })
  }
  const examples = value.senses.flatMap(sense => sense.examples.map(example => example.id))
  if (new Set(examples).size !== examples.length || value.senses.some(sense => value.removedSenseIds.includes(sense.id))) context.addIssue({ code: 'custom', message: '例句 ID 重复或已删除义项重新出现' })
})
export type FieldSource = z.infer<typeof fieldSourceSchema>
export type LemmaCandidate = z.infer<typeof lemmaCandidateSchema>
export type DictionarySense = z.infer<typeof dictionarySenseSchema>
export type Lexicon = z.infer<typeof lexiconSchema>

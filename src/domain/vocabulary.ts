import { z } from 'zod';
import { fieldSourceSchema, lemmaCandidateSchema, lexiconSchema, type Lexicon } from './lexicon';
import { nonBlankText, originSchema, recordFields, schemaVersionSchema, utcDateTimeSchema, uuidSchema, validateRevision } from './common';

export const contextSchema = z.strictObject({
  id: uuidSchema,
  text: nonBlankText(20_000),
  source: nonBlankText(2_000).optional(),
  translation: nonBlankText(20_000).optional(),
  translationLanguage: z.literal('zh-CN').optional(),
  translationSource: fieldSourceSchema.optional(),
}).superRefine((value, context) => {
  if (value.translation && (!value.translationLanguage || !value.translationSource)) context.addIssue({ code: 'custom', path: ['translation'], message: '原句译文必须标注语言和来源。' });
});

const uniqueContexts = z.array(contextSchema).superRefine((contexts, validation) => {
  const seenIds = new Set<string>();
  contexts.forEach((context, index) => {
    if (seenIds.has(context.id)) {
      validation.addIssue({ code: 'custom', path: [index, 'id'], message: '原句 ID 不可重复' });
    }
    seenIds.add(context.id);
  });
});

export const englishFieldsSchema = z.strictObject({
  phonetic: nonBlankText(200).optional(),
  pronunciationUrl: z.url({ protocol: /^https$/ }).optional(),
  collocations: z.array(nonBlankText(500)).optional(),
  inflections: z.array(nonBlankText(500)).optional(),
  derivatives: z.array(nonBlankText(500)).optional(),
});

export const germanConjugationSchema = z.strictObject({
  tense: nonBlankText(100),
  person: z.enum(['ich', 'du', 'er-sie-es', 'wir', 'ihr', 'sie-Sie']),
  form: nonBlankText(500),
});

export const germanFieldsSchema = z.strictObject({
  article: z.enum(['der', 'die', 'das']).optional(),
  plural: nonBlankText(500).optional(),
  infinitive: nonBlankText(500).optional(),
  past: nonBlankText(500).optional(),
  participleII: nonBlankText(500).optional(),
  auxiliary: z.enum(['haben', 'sein']).optional(),
  separablePrefix: nonBlankText(100).optional(),
  conjugations: z.array(germanConjugationSchema).optional(),
  government: z.array(z.enum(['nominative', 'accusative', 'dative', 'genitive'])).optional(),
  comparative: nonBlankText(500).optional(),
  superlative: nonBlankText(500).optional(),
  compoundParts: z.array(nonBlankText(500)).optional(),
  notes: nonBlankText(4_000).optional(),
});

const vocabularyFields = {
  lemma: nonBlankText(500),
  encounteredForm: nonBlankText(500).optional(),
  lemmaResolution: lemmaCandidateSchema.optional(),
  lexicon: lexiconSchema.optional(),
  meanings: z.array(nonBlankText(4_000)).optional(),
  partOfSpeech: nonBlankText(100).optional(),
  source: nonBlankText(2_000).optional(),
  contexts: uniqueContexts.optional(),
  tags: z.array(nonBlankText(80)).max(100).optional(),
};

function validateProjection(value: { lemma: string; encounteredForm?: string; lemmaResolution?: z.infer<typeof lemmaCandidateSchema>; lexicon?: Lexicon; meanings?: string[] }, context: z.RefinementCtx) {
  if (value.lemmaResolution && (!value.encounteredForm || value.lemmaResolution.lemma !== value.lemma)) context.addIssue({ code: 'custom', path: ['lemmaResolution'], message: '原型选择必须对应当前词条并保留原始词形。' })
  if (!value.lexicon) return
  const meanings = value.lexicon.senses.flatMap(sense => sense.chinese?.trim() ? [sense.chinese.trim()] : [])
  if (JSON.stringify(meanings) !== JSON.stringify(value.meanings ?? [])) context.addIssue({ code: 'custom', path: ['meanings'], message: '复习释义必须与结构化中文义项一致。' })
}

export const vocabularyPayloadSchema = z.discriminatedUnion('lang', [
  z.strictObject({ ...vocabularyFields, lang: z.literal('en'), en: englishFieldsSchema.optional() }),
  z.strictObject({ ...vocabularyFields, lang: z.literal('de'), de: germanFieldsSchema.optional() }),
]).superRefine(validateProjection);

const lifecycleFields = {
  ...recordFields,
  origin: originSchema,
  status: z.enum(['inbox', 'learning', 'paused', 'archived']),
};

export const vocabularyEntrySchema = z.discriminatedUnion('lang', [
  z.strictObject({ ...lifecycleFields, ...vocabularyFields, lang: z.literal('en'), en: englishFieldsSchema.optional() }),
  z.strictObject({ ...lifecycleFields, ...vocabularyFields, lang: z.literal('de'), de: germanFieldsSchema.optional() }),
]).superRefine(validateRevision).superRefine(validateProjection);

export const captureEventSchema = z.strictObject({
  id: uuidSchema,
  schemaVersion: schemaVersionSchema,
  deviceId: uuidSchema,
  capturedAt: utcDateTimeSchema,
  origin: originSchema,
  payload: vocabularyPayloadSchema,
});

export type VocabularyContext = z.infer<typeof contextSchema>;
export type EnglishFields = z.infer<typeof englishFieldsSchema>;
export type GermanFields = z.infer<typeof germanFieldsSchema>;
export type GermanConjugation = z.infer<typeof germanConjugationSchema>;
export type VocabularyPayload = z.infer<typeof vocabularyPayloadSchema>;
export type VocabularyEntry = z.infer<typeof vocabularyEntrySchema>;
export type CaptureEvent = Readonly<z.infer<typeof captureEventSchema>>;

/** New optional data must never be disguised inside a legacy wire envelope. */
export function payloadRequiresProtocol2(payload: VocabularyPayload): boolean {
  return payload.lexicon !== undefined || payload.encounteredForm !== undefined || payload.lemmaResolution !== undefined || Boolean(payload.contexts?.some(context => context.translation !== undefined || context.translationLanguage !== undefined || context.translationSource !== undefined));
}

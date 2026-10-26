import type { DictionarySense, FieldSource, Lexicon } from '../../src/domain/lexicon'

export const emptyLexicon = (): Lexicon => ({ schemaVersion: 1, senses: [], forms: [], fieldSources: {}, removedSenseIds: [] })
export const manualSense = (): DictionarySense => ({ id: crypto.randomUUID(), examples: [], sources: {} })
export const editedSource = (source?: FieldSource): FieldSource => source ? { ...source, modified: true } : { provider: 'manual' }
export function editSense(sense: DictionarySense, field: 'partOfSpeech' | 'chinese' | 'definition', value: string): DictionarySense {
  return { ...sense, [field]: value, sources: { ...sense.sources, [field]: editedSource(sense.sources[field]) } }
}
/** Only Chinese senses project to the legacy review surface. No POS is invented. */
export function senseMeanings(lexicon: Lexicon): string[] { return lexicon.senses.flatMap(sense => sense.chinese?.trim() ? [sense.chinese.trim()] : []) }
export function cleanLexicon(lexicon: Lexicon): Lexicon {
  return { ...lexicon, phonetic: lexicon.phonetic?.trim() || undefined, senses: lexicon.senses.filter(sense => sense.chinese?.trim() || sense.definition?.trim() || sense.partOfSpeech?.trim() || sense.examples.some(example => example.text.trim())).map(sense => ({
    ...sense, partOfSpeech: sense.partOfSpeech?.trim() || undefined, chinese: sense.chinese?.trim() || undefined, definition: sense.definition?.trim() || undefined,
    examples: sense.examples.filter(example => example.text.trim()).map(example => ({ ...example, text: example.text.trim(), translation: example.translation?.trim() || undefined })),
  })) }
}
/** Stable IDs join repeat results; manual edits/deletions always win over providers. */
export function mergeLexicon(current: Lexicon, incoming: Lexicon): Lexicon {
  const senses = current.senses.filter(sense => sense.chinese || sense.definition || sense.partOfSpeech || sense.examples.length || Object.keys(sense.sources).length).map(sense => {
    const next = incoming.senses.find(item => item.id === sense.id)
    if (!next) return sense
    const merged = { ...next, ...sense, sources: { ...next.sources, ...sense.sources } }
    for (const key of ['partOfSpeech', 'chinese', 'definition'] as const) {
      if (!sense.sources[key]?.modified && sense.sources[key]?.provider !== 'manual' && next[key]) {
        merged[key] = next[key]; merged.sources[key] = next.sources[key]
      }
    }
    // Example edits stay attached to their IDs, including intentionally empty edits.
    merged.examples = next.examples.map(example => sense.examples.find(item => item.id === example.id) ?? example)
    for (const example of sense.examples) if (!merged.examples.some(item => item.id === example.id)) merged.examples.push(example)
    return merged
  })
  for (const sense of incoming.senses) if (!current.removedSenseIds.includes(sense.id) && !senses.some(item => item.id === sense.id) && senses.length < 64) senses.push(sense)
  return { ...incoming, ...current, phonetic: current.fieldSources.phonetic?.modified ? current.phonetic : incoming.phonetic ?? current.phonetic,
    forms: incoming.forms.length ? incoming.forms : current.forms,
    fieldSources: { ...incoming.fieldSources, ...current.fieldSources }, senses }
}

import type { Language, VocabularyEntry, VocabularyPayload } from '../../domain'

export type VocabularySort = 'created-desc' | 'created-asc' | 'lemma-asc' | 'lemma-desc' | 'updated-desc'
export interface VocabularyQuery {
  search?: string
  language?: Language
  tag?: string
  status?: VocabularyEntry['status']
  sort?: VocabularySort
}

/** Suggestion key only. It never rewrites stored capitalization, articles or inflections. */
export function normalizeForDuplicate(lemma: string, lang: Language): string {
  const normalized = lemma.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase(lang)
  return lang === 'de' ? normalized.replace(/^(der|die|das)\s+/, '') : normalized
}

export function findPossibleDuplicates(entries: readonly VocabularyEntry[], payload: VocabularyPayload): VocabularyEntry[] {
  const key = normalizeForDuplicate(payload.lemma, payload.lang)
  return entries.filter((entry) => !entry.deletedAt && entry.lang === payload.lang && normalizeForDuplicate(entry.lemma, entry.lang) === key)
}

export function queryVocabulary(entries: readonly VocabularyEntry[], query: VocabularyQuery = {}): VocabularyEntry[] {
  const search = query.search?.normalize('NFKC').trim().toLocaleLowerCase()
  const filtered = entries.filter((entry) => {
    if (entry.deletedAt || (query.language && entry.lang !== query.language) || (query.status && entry.status !== query.status) || (query.tag && !entry.tags?.includes(query.tag))) return false
    if (!search) return true
    const fields = [entry.lemma, ...(entry.meanings ?? []), ...(entry.contexts?.map((context) => context.text) ?? []), ...(entry.tags ?? [])]
    return fields.some((field) => field.normalize('NFKC').toLocaleLowerCase().includes(search))
  })
  const sort = query.sort ?? 'created-desc'
  return filtered.sort((left, right) => {
    let difference: number
    if (sort === 'lemma-asc' || sort === 'lemma-desc') {
      difference = left.lemma.localeCompare(right.lemma, left.lang, { sensitivity: 'base' })
      if (sort === 'lemma-desc') difference *= -1
    } else {
      const field = sort === 'updated-desc' ? 'updatedAt' : 'createdAt'
      difference = Date.parse(left[field]) - Date.parse(right[field])
      if (sort !== 'created-asc') difference *= -1
    }
    return difference || left.id.localeCompare(right.id)
  })
}

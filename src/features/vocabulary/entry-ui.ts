import type { VocabularyEntry } from '../../domain'

export const statusLabels: Record<VocabularyEntry['status'], string> = { inbox: '待整理', learning: '已整理', paused: '暂停', archived: '已归档' }
export function displayLemma(entry: VocabularyEntry) { return entry.lang === 'de' && entry.de?.article ? `${entry.de.article} ${entry.lemma}` : entry.lemma }
export function splitTags(value: string) { return [...new Set(value.split(/[,，;；\n]/u).map((tag) => tag.trim()).filter(Boolean))] }

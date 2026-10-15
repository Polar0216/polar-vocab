import type { DataSnapshot, Flashcard, Language, ReviewEvent, VocabularyEntry } from '../../domain'
import { stateProblem } from './state-validation'

export interface StudyItem { card: Flashcard; entry: VocabularyEntry }
export interface LanguageProgress { active: number; due: number; dueReview: number; dueLearning: number; availableNew: number; newLearned: number; events: number; reviewedCards: number }
export interface LearningDashboard {
  timeZone: string; day: string; activeCards: number; totalCards: number; suspendedCards: number
  due: number; availableNew: number; completed: number; reviewedCards: number; newLearned: number
  languages: Record<Language, LanguageProgress>; week: { day: string; events: number; cards: number }[]
  queue: StudyItem[]; cards: StudyItem[]; nextLearningAt?: string; history: ReviewEvent[]; blockedCards: string[]
  historyLabels: Record<string, { lemma: string; lang: Language; deleted: boolean }>
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>()
export function localDayKey(date: Date, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  if (!dayFormatters.has(timeZone)) dayFormatters.set(timeZone, new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }))
  const parts = dayFormatters.get(timeZone)!.formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)!.value
  return value('year') + '-' + value('month') + '-' + value('day')
}
function previousCalendarDays(today: string): string[] {
  const [year, month, day] = today.split('-').map(Number)
  // UTC arithmetic here moves calendar labels, not 24-hour event windows (DST-safe).
  return Array.from({ length: 7 }, (_, index) => new Date(Date.UTC(year, month - 1, day - 6 + index)).toISOString().slice(0, 10))
}
export function cardEligible(entry: VocabularyEntry, card?: Flashcard): boolean {
  return !entry.deletedAt && entry.status === 'learning' && Boolean(entry.meanings?.length) &&
    (!card || !card.deletedAt && !card.suspended && card.template === 'meaning' && card.schedulerVersion === 'ts-fsrs@5.4.2' && !stateProblem(card.fsrsState))
}

export function learningDashboard(snapshot: DataSnapshot, now: Date, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): LearningDashboard {
  const day = localDayKey(now, timeZone)
  const entries = new Map(snapshot.vocabularies.map((entry) => [entry.id, entry]))
  const cardMap = new Map(snapshot.cards.map((card) => [card.id, card]))
  const deleted = new Set(snapshot.tombstones.map((record) => record.entityType + ':' + record.entityId))
  const ignored = new Set(snapshot.reviewResolutions.flatMap((resolution) => resolution.ignoredEventIds))
  const groups = new Map<string, ReviewEvent[]>()
  for (const event of snapshot.reviewEvents) {
    const key = event.cardId + ':' + event.parentStateId
    groups.set(key, [...(groups.get(key) ?? []), event])
  }
  const blocked = new Set<string>()
  const templates = new Map<string, string[]>()
  for (const card of snapshot.cards.filter((record) => !record.deletedAt)) { const key = card.vocabularyId + ':' + card.template; templates.set(key, [...(templates.get(key) ?? []), card.id]) }
  for (const ids of templates.values()) if (ids.length > 1) for (const id of ids) blocked.add(id)
  for (const events of groups.values()) if (events.filter((event) => !ignored.has(event.id)).length > 1) blocked.add(events[0].cardId)
  const history = snapshot.reviewEvents.filter((event) => !ignored.has(event.id)).sort((a, b) => Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt) || a.id.localeCompare(b.id))
  const eventDays = new Map(history.map((event) => [event.id, localDayKey(new Date(event.reviewedAt), timeZone)]))
  const today = history.filter((event) => eventDays.get(event.id) === day)
  const historyLabels: LearningDashboard['historyLabels'] = {}
  for (const event of history) {
    const card = cardMap.get(event.cardId)
    const entry = entries.get(card?.vocabularyId ?? '')
    if (entry) historyLabels[event.cardId] = { lemma: entry.lemma, lang: entry.lang, deleted: !!entry.deletedAt || !!card?.deletedAt }
  }
  const firstLearned = new Set(today.filter((event) => event.beforeState.state === 0).map((event) => event.cardId))
  const nondeleted = snapshot.cards.filter((card) => !card.deletedAt && !deleted.has('card:' + card.id))
  const cards = nondeleted.flatMap((card): StudyItem[] => {
    const entry = entries.get(card.vocabularyId)
    return entry && !entry.deletedAt && !deleted.has('vocabulary:' + entry.id) ? [{ entry, card }] : []
  })
  const active = cards.filter(({ entry, card }) => cardEligible(entry, card) && !blocked.has(card.id))
  const languages = {} as Record<Language, LanguageProgress>
  const queue: StudyItem[] = []
  for (const language of ['en', 'de'] as const) {
    const languageCards = active.filter((item) => item.entry.lang === language)
    const events = today.filter((event) => entries.get(cardMap.get(event.cardId)?.vocabularyId ?? '')?.lang === language)
    const learned = new Set(events.filter((event) => event.beforeState.state === 0).map((event) => event.cardId))
    const enabled = snapshot.settings.reviewEnabled[language]
    const due = enabled ? languageCards.filter((item) => item.card.fsrsState.state !== 0 && Date.parse(item.card.fsrsState.due) <= now.getTime()) : []
    const newCards = enabled ? languageCards.filter((item) => item.card.fsrsState.state === 0 && Date.parse(item.card.fsrsState.due) <= now.getTime())
      .sort((a, b) => Date.parse(a.card.createdAt) - Date.parse(b.card.createdAt) || a.card.id.localeCompare(b.card.id))
      .slice(0, Math.max(0, snapshot.settings.dailyNew[language] - learned.size)) : []
    languages[language] = { active: languageCards.length, due: due.length, dueReview: due.filter((item) => item.card.fsrsState.state === 2).length,
      dueLearning: due.filter((item) => item.card.fsrsState.state !== 2).length, availableNew: newCards.length,
      newLearned: learned.size, events: events.length, reviewedCards: new Set(events.map((event) => event.cardId)).size }
    queue.push(...due, ...newCards)
  }
  queue.sort((a, b) => Number(a.card.fsrsState.state === 0) - Number(b.card.fsrsState.state === 0) || Date.parse(a.card.fsrsState.due) - Date.parse(b.card.fsrsState.due) || a.card.id.localeCompare(b.card.id))
  const future = active.filter((item) => snapshot.settings.reviewEnabled[item.entry.lang] && [1, 3].includes(item.card.fsrsState.state) && Date.parse(item.card.fsrsState.due) > now.getTime())
    .sort((a, b) => Date.parse(a.card.fsrsState.due) - Date.parse(b.card.fsrsState.due))
  const week = previousCalendarDays(day).map((date) => {
    const events = history.filter((event) => eventDays.get(event.id) === date)
    return { day: date, events: events.length, cards: new Set(events.map((event) => event.cardId)).size }
  })
  return { timeZone, day, activeCards: active.length, totalCards: nondeleted.length, suspendedCards: nondeleted.filter((card) => card.suspended).length,
    due: languages.en.due + languages.de.due, availableNew: languages.en.availableNew + languages.de.availableNew,
    completed: today.length, reviewedCards: new Set(today.map((event) => event.cardId)).size, newLearned: firstLearned.size,
    languages, week, queue, cards, nextLearningAt: future[0]?.card.fsrsState.due, history, blockedCards: [...blocked], historyLabels }
}

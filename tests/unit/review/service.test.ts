import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalVocabularyService } from '../../../src/features/vocabulary/service'
import { LocalReviewService, type GradeCommand } from '../../../src/features/review/service'
import { PolarDatabase } from '../../../src/storage/database'
import type { Flashcard } from '../../../src/domain'

let vocabulary: LocalVocabularyService
let review: LocalReviewService
let clock: Date
beforeEach(async () => {
  vocabulary = new LocalVocabularyService(new PolarDatabase('review-test-' + crypto.randomUUID()))
  clock = new Date('2026-10-14T00:00:00.000Z')
  review = new LocalReviewService(vocabulary, () => clock)
  await vocabulary.initialize()
})
afterEach(async () => { await vocabulary.db.delete() })
async function prepared(lemma = 'public-fixture', lang: 'en' | 'de' = 'en') {
  const entry = await vocabulary.add({ lang, lemma, meanings: ['人工释义'], status: 'learning' })
  return (await review.create(await review.previewCreate([entry.id])))[0]
}
function command(card: Flashcard, rating: GradeCommand['rating'] = 'Good'): GradeCommand {
  return { eventId: crypto.randomUUID(), cardId: card.id, expectedRevisionId: card.revisionId, expectedStateId: card.stateId, rating }
}
describe('atomic cards and immutable grading', () => {
  it('creates only qualified words after preview, skips duplicates including suspended templates', async () => {
    const inbox = await vocabulary.add({ lang: 'en', lemma: 'inbox' })
    const missing = await vocabulary.add({ lang: 'en', lemma: 'empty', status: 'learning' })
    const card = await prepared()
    await review.setSuspended(card.id, true, card.revisionId)
    const preview = await review.previewCreate([inbox.id, missing.id, card.vocabularyId, card.vocabularyId])
    expect(preview).toMatchObject({ count: 0, skipped: 3 })
    expect(await vocabulary.db.cards.count()).toBe(1)
    expect(await review.create(preview)).toEqual([])
  })
  it('supports batch creation and rolls back all cards/outbox if any write fails', async () => {
    const a = await vocabulary.add({ lang: 'en', lemma: 'a', meanings: ['甲'], status: 'learning' })
    const b = await vocabulary.add({ lang: 'de', lemma: 'b', meanings: ['乙'], status: 'learning' })
    const preview = await review.previewCreate([a.id, b.id])
    expect(preview.count).toBe(2); expect(await vocabulary.db.cards.count()).toBe(0)
    const pending = await vocabulary.db.pendingOperations.count()
    const fail = (_key: unknown, value: { kind: string }) => { if (value.kind === 'upsert-card') throw new Error('injected') }
    vocabulary.db.pendingOperations.hook('creating', fail)
    await expect(review.create(preview)).rejects.toThrow('injected')
    vocabulary.db.pendingOperations.hook('creating').unsubscribe(fail)
    expect(await vocabulary.db.cards.count()).toBe(0)
    expect(await vocabulary.db.pendingOperations.count()).toBe(pending)
    expect(await review.create(preview)).toHaveLength(2)
  })
  it('rejects stale or mutated creation preview and serializes concurrent duplicate creation', async () => {
    const entry = await vocabulary.add({ lang: 'en', lemma: 'planned', meanings: ['人工'], status: 'learning' })
    const old = await review.previewCreate([entry.id])
    await vocabulary.batchUpdate([entry.id], { addTags: ['changed'] })
    await expect(review.create(old)).rejects.toMatchObject({ code: 'stale-state' })
    expect(await vocabulary.db.cards.count()).toBe(0)
    const another = new LocalReviewService(vocabulary, () => clock)
    const a = await review.previewCreate([entry.id]); const b = await another.previewCreate([entry.id])
    a.vocabularyIds.push(crypto.randomUUID())
    const results = await Promise.all([review.create(a), another.create(b)])
    expect(results.flat()).toHaveLength(1)
    expect(await vocabulary.db.cards.count()).toBe(1)
  })
  it('atomically saves real state, event, revision and two pending records', async () => {
    const card = await prepared()
    const oldPending = await vocabulary.db.pendingOperations.count()
    const result = await review.grade(command(card))
    expect(result.event.parentStateId).toBe(card.stateId)
    expect(result.card.stateId).toBe(result.event.resultingStateId)
    expect(result.card.fsrsState).toEqual(result.event.afterState)
    expect(result.card.lastReviewEventId).toBe(result.event.id)
    expect(result.event.configuration.weights).toHaveLength(21)
    expect(await vocabulary.db.reviewEvents.count()).toBe(1)
    expect(await vocabulary.db.pendingOperations.count()).toBe(oldPending + 2)
  })
  it('rolls back event, state and pending when the final outbox write fails', async () => {
    const card = await prepared(); const pending = await vocabulary.db.pendingOperations.count()
    const fail = (_key: unknown, value: { kind: string }) => { if (value.kind === 'upsert-card') throw new Error('last-write-failed') }
    vocabulary.db.pendingOperations.hook('creating', fail)
    await expect(review.grade(command(card))).rejects.toThrow('last-write-failed')
    vocabulary.db.pendingOperations.hook('creating').unsubscribe(fail)
    expect(await vocabulary.db.cards.get(card.id)).toEqual(card)
    expect(await vocabulary.db.reviewEvents.count()).toBe(0)
    expect(await vocabulary.db.pendingOperations.count()).toBe(pending)
  })
  it('deduplicates concurrent same-ID clicks and retries after a fresh service instance', async () => {
    const card = await prepared(); const request = command(card)
    const results = await Promise.all([review.grade(request), review.grade(request)])
    expect(results.filter((result) => result.repeated)).toHaveLength(1)
    const fresh = new LocalReviewService(vocabulary, () => new Date(clock.getTime() + 10_000))
    expect((await fresh.grade(request)).repeated).toBe(true)
    expect(await vocabulary.db.reviewEvents.count()).toBe(1)
    await expect(fresh.grade({ ...request, rating: 'Easy' })).rejects.toMatchObject({ code: 'immutable-id' })
  })
  it('rejects concurrent stale scoring from a second database connection', async () => {
    const card = await prepared()
    const otherVocabulary = new LocalVocabularyService(new PolarDatabase(vocabulary.db.name))
    await otherVocabulary.initialize()
    try {
      const other = new LocalReviewService(otherVocabulary, () => clock)
      const results = await Promise.allSettled([review.grade(command(card)), other.grade(command(card, 'Easy'))])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult
      expect(rejected.reason).toMatchObject({ code: 'stale-state' })
      expect(await vocabulary.db.reviewEvents.count()).toBe(1)
    } finally { otherVocabulary.db.close() }
  })
  it('limits only new learning; learning steps become due again and retain independent event counts', async () => {
    await vocabulary.updateSettings({ dailyNew: { en: 1, de: 1 } })
    const first = await prepared('first'); const second = await prepared('second')
    const tasks = await review.dashboard(); expect(tasks.availableNew).toBe(1)
    const selected = tasks.queue[0].card
    const result = await review.grade(command(selected, 'Again'))
    const unselected = first.id === selected.id ? second : first
    await expect(review.grade(command(unselected))).rejects.toMatchObject({ code: 'quota' })
    clock = new Date(result.card.fsrsState.due)
    expect((await review.dashboard()).languages.en).toMatchObject({ due: 1, dueLearning: 1, availableNew: 0, newLearned: 1 })
    await review.grade(command(result.card, 'Good'))
    expect((await review.dashboard()).languages.en).toMatchObject({ events: 2, reviewedCards: 1, newLearned: 1 })
    const tomorrow = new Date(clock); tomorrow.setDate(clock.getDate() + 1); clock = tomorrow
    expect((await review.dashboard()).languages.en).toMatchObject({ newLearned: 0, availableNew: 1, dueLearning: 1 })
  })
  it('prioritizes due old cards, filters disabled/archived/suspended words and never loses deletion history', async () => {
    const old = await prepared('old', 'de')
    const result = await review.grade(command(old, 'Easy'))
    clock = new Date(result.card.fsrsState.due)
    await prepared('new')
    expect((await review.dashboard()).queue[0].card.id).toBe(old.id)
    await vocabulary.batchUpdate([old.vocabularyId], { status: 'archived' })
    expect((await review.dashboard()).queue.some((item) => item.card.id === old.id)).toBe(false)
    await vocabulary.softDelete([old.vocabularyId])
    await expect(review.grade(command(result.card))).rejects.toMatchObject({ code: 'stale-state' })
    expect(await vocabulary.db.reviewEvents.count()).toBe(1)
    expect((await vocabulary.db.cards.get(old.id))?.deletedAt).toBeTruthy()
    await vocabulary.updateSettings({ reviewEnabled: { en: false, de: true } })
    expect((await review.dashboard()).availableNew).toBe(0)
  })
  it('suspends/resumes without rescheduling and rejects stale management changes', async () => {
    const card = await prepared(); await review.setSuspended(card.id, true, card.revisionId)
    const suspended = (await vocabulary.db.cards.get(card.id))!
    expect((await review.dashboard()).activeCards).toBe(0)
    expect(suspended.fsrsState).toEqual(card.fsrsState)
    await expect(review.setSuspended(card.id, false, card.revisionId)).rejects.toMatchObject({ code: 'stale-state' })
    await review.setSuspended(card.id, false, suspended.revisionId)
    expect((await review.dashboard()).activeCards).toBe(1)
  })
  it('rejects early scoring and backward clock while settings updates do not reset history', async () => {
    const result = await review.grade(command(await prepared(), 'Good'))
    await expect(review.grade(command(result.card))).rejects.toMatchObject({ code: 'not-due' })
    await vocabulary.updateSettings({ desiredRetention: 0.95 })
    expect((await vocabulary.db.cards.get(result.card.id))?.fsrsState).toEqual(result.card.fsrsState)
    clock = new Date(result.card.fsrsState.due)
    const next = await review.grade(command(result.card))
    expect(next.event.configuration.requestRetention).toBe(0.95)
    expect(await vocabulary.db.reviewEvents.count()).toBe(2)
    await expect(vocabulary.updateSettings({ desiredRetention: 0.1 })).rejects.toThrow()
    await expect(vocabulary.appendPending('append-review', next.event)).rejects.toThrow('同一写事务')
  })
  it('does not append history when current memory state diverges from its last immutable event', async () => {
    const result = await review.grade(command(await prepared(), 'Good'))
    clock = new Date(result.card.fsrsState.due)
    const corrupted = { ...result.card, fsrsState: { ...result.card.fsrsState, stability: result.card.fsrsState.stability + 1 } }
    await vocabulary.db.cards.put(corrupted)
    await expect(review.grade(command(corrupted))).rejects.toMatchObject({ code: 'stale-state' })
    expect(await vocabulary.db.reviewEvents.count()).toBe(1)
    expect(await vocabulary.db.cards.get(corrupted.id)).toEqual(corrupted)
  })
})

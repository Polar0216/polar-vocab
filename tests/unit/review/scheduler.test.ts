import { describe, expect, it } from 'vitest'
import { createEmptyCard, fsrs, Rating, State, default_w } from 'ts-fsrs'
import { FsrsAdapter, defaultConfiguration, deserializeFsrs, parametersFor, serializeFsrs } from '../../../src/features/review/fsrs-adapter'
import { card, id } from '../domain/fixtures'

const adapter = new FsrsAdapter()
const time = '2026-10-14T00:00:00.000Z'
describe('real ts-fsrs 5.4.2 adapter', () => {
  it('uses upstream empty state and full defaults instead of guessed weights', () => {
    expect(adapter.empty(time)).toEqual(serializeFsrs(createEmptyCard(time)))
    expect(defaultConfiguration().weights).toEqual(default_w)
    expect(defaultConfiguration()).toMatchObject({ requestRetention: 0.9, enableFuzz: false, enableShortTerm: true, learningSteps: ['1m', '10m'], relearningSteps: ['10m'] })
  })
  it.each(['Again', 'Hard', 'Good', 'Easy'] as const)('matches upstream %s scheduling and preserves event causality', (rating) => {
    const current = { ...card(), fsrsState: adapter.empty(time) }
    const configuration = defaultConfiguration()
    const scheduled = adapter.next({ card: current, rating, reviewedAt: time, deviceId: id(3), eventId: id(81), resultingStateId: id(82), settingsVersion: id(2), configuration })
    const real = fsrs(parametersFor(configuration)).next(createEmptyCard(time), time, Rating[rating])
    expect(scheduled.card.fsrsState).toEqual(serializeFsrs(real.card))
    expect(scheduled.event).toMatchObject({ parentStateId: current.stateId, resultingStateId: id(82), parentReviewEventId: null, beforeState: current.fsrsState, afterState: serializeFsrs(real.card), rating })
    expect(scheduled.card.parentRevisionIds).toEqual([current.revisionId])
    expect(Date.parse(scheduled.card.fsrsState.due)).toBeGreaterThan(Date.parse(time))
  })
  it('transitions New → Learning → Review and Review → Relearning using real algorithm', () => {
    let current = { ...card(), fsrsState: adapter.empty(time) }
    const score = (rating: 'Good' | 'Again' | 'Easy', at: string) => {
      current = adapter.next({ card: current, rating, reviewedAt: at, deviceId: id(3), eventId: crypto.randomUUID(), resultingStateId: crypto.randomUUID(), settingsVersion: id(2), configuration: defaultConfiguration() }).card
    }
    score('Good', time); expect(current.fsrsState.state).toBe(State.Learning)
    score('Good', current.fsrsState.due); expect(current.fsrsState.state).toBe(State.Review)
    score('Again', current.fsrsState.due); expect(current.fsrsState.state).toBe(State.Relearning)
    expect(current.fsrsState.lapses).toBe(1)
    score('Good', current.fsrsState.due); expect(current.fsrsState.state).toBe(State.Review)
    expect(current.fsrsState.reps).toBe(4)
  })
  it('round-trips UTC date fields, including DST-adjacent and offset instants', () => {
    for (const date of ['2026-03-08T01:59:00-05:00', '2026-11-01T01:30:00-04:00', '2026-10-14T00:01:00+08:00']) {
      const real = fsrs().next(createEmptyCard(date), date, Rating.Good).card
      expect(deserializeFsrs(serializeFsrs(real))).toEqual(real)
      expect(serializeFsrs(real).last_review).toBe(new Date(date).toISOString())
    }
  })
  it('is reproducible with identical algorithm input and independent UUID metadata', () => {
    const request = { card: { ...card(), fsrsState: adapter.empty(time) }, rating: 'Good' as const, reviewedAt: time, deviceId: id(3), eventId: id(81), resultingStateId: id(82), settingsVersion: id(2), configuration: defaultConfiguration() }
    expect(adapter.next(request).event).toEqual(adapter.next(request).event)
  })
  it('rejects invalid configuration instead of upstream silent migration or clipping', () => {
    const valid = defaultConfiguration()
    for (const invalid of [{ ...valid, requestRetention: 0 }, { ...valid, requestRetention: 1 }, { ...valid, weights: [1] }, { ...valid, weights: Array(21).fill(-1) }, { ...valid, learningSteps: ['0m'] }, { ...valid, relearningSteps: ['unknown'] }, { ...valid, maximumInterval: 0 }]) {
      expect(() => parametersFor(invalid)).toThrow()
    }
    expect(defaultConfiguration(0.7).requestRetention).toBe(0.7)
    expect(defaultConfiguration(0.99).requestRetention).toBe(0.99)
    expect(() => defaultConfiguration(0)).toThrow()
  })
})

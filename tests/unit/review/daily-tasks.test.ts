import { describe, expect, it } from 'vitest'
import { learningDashboard, localDayKey } from '../../../src/features/review/daily-tasks'
import { snapshot, review, id, card } from '../domain/fixtures'

describe('local calendar statistics', () => {
  it('uses local midnight instead of UTC date, including DST repeated and missing hours', () => {
    expect(localDayKey(new Date('2026-10-13T16:01:00Z'), 'Asia/Shanghai')).toBe('2026-10-14')
    expect(localDayKey(new Date('2026-10-14T00:01:00Z'), 'America/New_York')).toBe('2026-10-13')
    for (const date of ['2026-03-08T06:59:00Z', '2026-03-08T07:01:00Z']) expect(localDayKey(new Date(date), 'America/New_York')).toBe('2026-03-08')
    for (const date of ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z']) expect(localDayKey(new Date(date), 'America/New_York')).toBe('2026-11-01')
  })
  it('counts distinct first-learned cards separately from repeated review events and reports seven calendar dates', () => {
    const data = snapshot(); data.cards = [card()]
    data.reviewEvents = [
      { ...review(), reviewedAt: '2026-03-08T06:59:00.000Z' },
      { ...review(), id: id(43), parentStateId: id(44), reviewedAt: '2026-03-08T07:01:00.000Z', beforeState: { ...review().beforeState, state: 1 } },
    ]
    const result = learningDashboard(data, new Date('2026-03-08T08:00:00Z'), 'America/New_York')
    expect(result).toMatchObject({ completed: 2, reviewedCards: 1, newLearned: 1 })
    expect(result.week.map((day) => day.day)).toEqual(['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08'])
    expect(result.week.at(-1)).toMatchObject({ events: 2, cards: 1 })
    expect(learningDashboard(data, new Date('2026-03-09T04:01:00Z'), 'America/New_York').newLearned).toBe(0)
  })
  it('blocks unresolved restored sibling branches without deleting either event', () => {
    const data = snapshot(); data.cards = [card()]; data.reviewEvents = [review(), { ...review(), id: id(42), resultingStateId: id(43) }]
    const result = learningDashboard(data, new Date('2026-10-14T00:00:00Z'), 'Asia/Shanghai')
    expect(result.blockedCards).toEqual([card().id])
    expect(result.queue).toEqual([])
    expect(result.history).toHaveLength(2)
  })
  it('keeps deleted-card history language labels while excluding it from active tasks', () => {
    const data = snapshot(); data.vocabularies[0].deletedAt = '2026-10-14T00:00:00.000Z'
    data.cards = [{ ...card(), deletedAt: '2026-10-14T00:00:00.000Z', suspended: true }]; data.reviewEvents = [review()]
    const result = learningDashboard(data, new Date('2026-10-14T00:00:00Z'), 'Asia/Shanghai')
    expect(result.activeCards).toBe(0)
    expect(result.historyLabels[card().id]).toMatchObject({ lang: 'en', deleted: true, lemma: 'example' })
    expect(result.history).toHaveLength(1)
  })
  it('orders instants correctly when older UTC strings omit fractional seconds', () => {
    const data = snapshot(); data.cards = [card()]
    data.reviewEvents = [{ ...review(), reviewedAt: '2026-10-14T00:00:00Z' }, { ...review(), id: id(45), parentStateId: id(46), reviewedAt: '2026-10-14T00:00:00.100Z' }]
    const result = learningDashboard(data, new Date('2026-10-14T01:00:00Z'), 'Asia/Shanghai')
    expect(result.history[0].id).toBe(id(45))
  })
})

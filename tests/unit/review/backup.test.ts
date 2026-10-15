import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalVocabularyService } from '../../../src/features/vocabulary/service'
import { LocalReviewService } from '../../../src/features/review/service'
import { LocalBackupService } from '../../../src/features/import-export/backup-service'
import { PolarDatabase } from '../../../src/storage/database'
import type { Flashcard } from '../../../src/domain'

let vocabulary: LocalVocabularyService
let review: LocalReviewService
let backup: LocalBackupService
let now: Date
beforeEach(async () => {
  vocabulary = new LocalVocabularyService(new PolarDatabase('learning-backup-' + crypto.randomUUID()))
  now = new Date('2026-10-14T00:00:00Z')
  review = new LocalReviewService(vocabulary, () => now)
  backup = new LocalBackupService(vocabulary)
  await vocabulary.initialize()
})
afterEach(async () => { await vocabulary.db.delete() })
async function rawBackup(): Promise<string> {
  const blob = await backup.exportBackup()
  return new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob) })
}
async function prepare(): Promise<Flashcard> {
  const word = await vocabulary.add({ lang: 'de', lemma: 'Ergebnis', meanings: ['结果'], status: 'learning', de: { article: 'das' } })
  return (await review.create(await review.previewCreate([word.id])))[0]
}
function score(card: Flashcard) { return review.grade({ cardId: card.id, expectedStateId: card.stateId, expectedRevisionId: card.revisionId, rating: 'Good', eventId: crypto.randomUUID() }) }
describe('learning backup compatibility', () => {
  it('restores schema1 Phase1 backups without cards and preserves the format version', async () => {
    await vocabulary.add({ lang: 'en', lemma: 'old-inbox' })
    const legacy = JSON.parse(await rawBackup()); legacy.backupVersion = 1; delete legacy.local.connections; delete legacy.local.syncJobs; delete legacy.local.conflictDecisions
    const raw = JSON.stringify(legacy)
    await backup.restore(await backup.preview(new File([raw], 'phase1.json')), 'replace-local')
    expect((await review.dashboard()).totalCards).toBe(0)
    expect(JSON.parse(await rawBackup())).toMatchObject({ backupVersion: 2, schemaVersion: 1 })
  })
  it('survives full clear/restore, repeated restoration and continues real scheduling without losing history', async () => {
    const result = await score(await prepare())
    const raw = await rawBackup()
    await backup.clearLocal(await backup.prepareClear())
    expect(await vocabulary.db.reviewEvents.count()).toBe(0)
    await backup.restore(await backup.preview(new File([raw], 'learned.json')), 'replace-local')
    await backup.restore(await backup.preview(new File([raw], 'learned.json')), 'replace-local')
    expect(await vocabulary.db.reviewEvents.count()).toBe(1)
    expect(await vocabulary.db.cards.get(result.card.id)).toEqual(result.card)
    now = new Date(result.card.fsrsState.due)
    expect((await review.dashboard()).due).toBe(1)
    const next = await score(result.card)
    expect(next.event.parentReviewEventId).toBe(result.event.id)
    expect(await vocabulary.db.reviewEvents.count()).toBe(2)
  })
  it('refuses unknown algorithm, inconsistent state and silent weight migrations without mutation', async () => {
    await score(await prepare())
    const raw = await rawBackup()
    const tamper = [
      (data: ReturnType<typeof JSON.parse>) => { data.snapshot.cards[0].schedulerVersion = 'future-scheduler' },
      (data: ReturnType<typeof JSON.parse>) => { data.snapshot.cards[0].fsrsState.reps = 0 },
      (data: ReturnType<typeof JSON.parse>) => { data.snapshot.reviewEvents[0].configuration.weights = [1] },
      (data: ReturnType<typeof JSON.parse>) => { data.snapshot.reviewEvents[0].afterState.stability += 1 },
    ]
    for (const change of tamper) {
      const data = JSON.parse(raw); change(data)
      await expect(backup.preview(new File([JSON.stringify(data)], 'invalid-learning.json'))).rejects.toMatchObject({ code: 'invalid-data' })
      expect(await vocabulary.db.reviewEvents.count()).toBe(1)
    }
  })
  it('refuses two live cards for one template without merging their memory states', async () => {
    await prepare()
    const data = JSON.parse(await rawBackup())
    data.snapshot.cards.push({ ...data.snapshot.cards[0], id: crypto.randomUUID() })
    await expect(backup.preview(new File([JSON.stringify(data)], 'duplicate-template.json'))).rejects.toMatchObject({ code: 'invalid-data' })
    expect(await vocabulary.db.cards.count()).toBe(1)
    expect(await vocabulary.db.reviewEvents.count()).toBe(0)
  })
  it('preserves current review history when an older Phase1 backup or a nonterminal state is selected', async () => {
    const oldPhase1 = await rawBackup()
    const first = await score(await prepare())
    await expect(backup.preview(new File([oldPhase1], 'old-phase1.json'))).rejects.toMatchObject({ code: 'review-history' })
    now = new Date(first.card.fsrsState.due); await score(first.card)
    const oldState = JSON.parse(await rawBackup())
    oldState.snapshot.cards[0] = first.card
    await expect(backup.preview(new File([JSON.stringify(oldState)], 'old-state.json'))).rejects.toMatchObject({ code: 'invalid-data' })
    expect(await vocabulary.db.reviewEvents.count()).toBe(2)
  })
})

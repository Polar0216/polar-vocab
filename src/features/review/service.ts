import {
  flashcardSchema, reviewRatingSchema, uuidSchema, type Flashcard, type Language, type ReviewEvent, type ReviewRating, type UUID,
} from '../../domain'
import { canonicalJson } from '../../storage/capture'
import type { LocalVocabularyService } from '../vocabulary/service'
import { FsrsAdapter, defaultConfiguration, SCHEDULER_VERSION } from './fsrs-adapter'
import { cardEligible, learningDashboard, type LearningDashboard } from './daily-tasks'

export class ReviewError extends Error {
  readonly code: 'ineligible' | 'stale-state' | 'immutable-id' | 'not-due' | 'quota' | 'unsupported'
  constructor(code: ReviewError['code'], message: string) { super(message); this.name = 'ReviewError'; this.code = code }
}
export interface CreateCardsPreview { id: UUID; vocabularyIds: UUID[]; count: number; skipped: number }
export interface GradeCommand { eventId: UUID; cardId: UUID; expectedStateId: UUID; expectedRevisionId: UUID; rating: ReviewRating }
export interface GradeResult { event: ReviewEvent; card: Flashcard; repeated: boolean }

/** No remote calls. The shared local transaction owns cards, events and outbox together. */
export class LocalReviewService {
  readonly vocabulary: LocalVocabularyService
  private readonly adapter = new FsrsAdapter()
  private readonly clock: () => Date
  private readonly plans = new Map<UUID, { ids: UUID[]; revisions: Map<UUID, UUID> }>()
  constructor(vocabulary: LocalVocabularyService, clock: () => Date = () => new Date()) { this.vocabulary = vocabulary; this.clock = clock }

  async dashboard(): Promise<LearningDashboard> { return learningDashboard(await this.vocabulary.snapshot(), this.clock()) }

  async previewCreate(ids: readonly UUID[]): Promise<CreateCardsPreview> {
    const snapshot = await this.vocabulary.snapshot()
    const unique = [...new Set(ids.map((id) => uuidSchema.parse(id)))]
    const entries = new Map(snapshot.vocabularies.map((entry) => [entry.id, entry]))
    const eligible = unique.filter((id) => {
      const entry = entries.get(id)
      return entry && cardEligible(entry) && !snapshot.tombstones.some((tombstone) => tombstone.entityType === 'vocabulary' && tombstone.entityId === id)
        && !snapshot.cards.some((card) => card.vocabularyId === id && card.template === 'meaning' && !card.deletedAt)
    })
    const id = crypto.randomUUID()
    this.plans.clear()
    this.plans.set(id, { ids: eligible, revisions: new Map(eligible.map((entryId) => [entryId, entries.get(entryId)!.revisionId])) })
    return { id, vocabularyIds: [...eligible], count: eligible.length, skipped: unique.length - eligible.length }
  }

  async create(preview: CreateCardsPreview): Promise<Flashcard[]> {
    const plan = this.plans.get(preview.id)
    if (!plan) throw new ReviewError('stale-state', '卡片预览已失效，请重新检查。')
    const cards = await this.vocabulary.transaction(async () => {
      const db = this.vocabulary.db
      const settings = await this.vocabulary.getSettings()
      const now = this.clock().toISOString()
      const created: Flashcard[] = []
      for (const id of plan.ids) {
        const entry = await this.vocabulary.get(id)
        if (!entry || !cardEligible(entry) || entry.revisionId !== plan.revisions.get(id)) throw new ReviewError('stale-state', '词条已变化或不再符合条件，请重新预览；未创建任何卡片。')
        // Suspended cards also occupy this template: resume instead of creating duplicates.
        const existing = await db.cards.where('[vocabularyId+template]').equals([id, 'meaning']).toArray()
        if (existing.some((card) => !card.deletedAt)) continue
        const card = flashcardSchema.parse({ id: crypto.randomUUID(), schemaVersion: 1, revisionId: crypto.randomUUID(), parentRevisionIds: [],
          createdAt: now, updatedAt: now, vocabularyId: id, template: 'meaning', suspended: false, stateId: crypto.randomUUID(),
          fsrsState: this.adapter.empty(now), schedulerVersion: SCHEDULER_VERSION, settingsVersion: settings.revisionId })
        await db.cards.add(card)
        await this.vocabulary.appendPending('upsert-card', card)
        created.push(card)
      }
      return created
    })
    this.plans.delete(preview.id)
    return cards
  }

  async setSuspended(id: UUID, suspended: boolean, expectedRevisionId: UUID): Promise<void> {
    uuidSchema.parse(id); uuidSchema.parse(expectedRevisionId)
    await this.vocabulary.transaction(async () => {
      const card = flashcardSchema.parse(await this.vocabulary.db.cards.get(id))
      const entry = await this.vocabulary.get(card.vocabularyId)
      if (card.deletedAt || !entry) throw new ReviewError('ineligible', '卡片或词条已删除。')
      if (card.revisionId !== expectedRevisionId) throw new ReviewError('stale-state', '卡片已被另一页面更新，请重新读取。')
      if (!suspended && !cardEligible(entry)) throw new ReviewError('ineligible', '请先将词条整理完成并补充释义，再恢复学习。')
      if (card.suspended === suspended) return
      const next = flashcardSchema.parse({ ...card, suspended, revisionId: crypto.randomUUID(), parentRevisionIds: [card.revisionId], updatedAt: this.clock().toISOString() })
      await this.vocabulary.db.cards.put(next)
      await this.vocabulary.appendPending('upsert-card', next)
    })
  }

  async grade(command: GradeCommand): Promise<GradeResult> {
    for (const id of [command.eventId, command.cardId, command.expectedStateId, command.expectedRevisionId]) uuidSchema.parse(id)
    reviewRatingSchema.parse(command.rating)
    return this.vocabulary.transaction(async () => {
      const db = this.vocabulary.db
      const card = flashcardSchema.parse(await db.cards.get(command.cardId))
      const previous = await db.reviewEvents.get(command.eventId)
      if (previous) {
        if (previous.cardId !== command.cardId || previous.parentStateId !== command.expectedStateId || previous.rating !== command.rating || previous.deviceId !== await this.vocabulary.getDeviceId()) {
          throw new ReviewError('immutable-id', '同一评分 ID 对应不同操作，已拒绝覆盖复习事件。')
        }
        return { event: previous, card, repeated: true }
      }
      if (card.stateId !== command.expectedStateId || card.revisionId !== command.expectedRevisionId) throw new ReviewError('stale-state', '另一页面已更新这张卡片，请重新读取任务后评分。')
      if (card.lastReviewEventId) {
        const parent = await db.reviewEvents.get(card.lastReviewEventId)
        const resolution = await db.reviewResolutions.filter((record) => record.cardId === card.id && record.resultingStateId === card.stateId && (record.selectedHeadEventId ?? record.selectedEventId) === parent?.id && canonicalJson(record.resolvedState) === canonicalJson(card.fsrsState)).first()
        if (!parent || !resolution && (parent.resultingStateId !== card.stateId || canonicalJson(parent.afterState) !== canonicalJson(card.fsrsState))) throw new ReviewError('stale-state', '卡片状态与末次事件不一致或需要分支决议，已停止评分。')
      } else if (card.fsrsState.reps > 0) throw new ReviewError('stale-state', '学习状态缺少复习历史，不能猜测后继续评分。')
      const entry = await this.vocabulary.get(card.vocabularyId)
      if (!entry || !cardEligible(entry, card)) throw new ReviewError('ineligible', '卡片已暂停、词条未整理或已删除，不能评分。')
      if (card.schedulerVersion !== SCHEDULER_VERSION) throw new ReviewError('unsupported', '卡片算法版本不兼容，不能猜测调度。')
      const now = this.clock()
      if (Date.parse(card.fsrsState.due) > now.getTime() || card.fsrsState.last_review && Date.parse(card.fsrsState.last_review) >= now.getTime()) throw new ReviewError('not-due', '卡片尚未到期或设备时钟早于上次评分，请稍后再试。')
      const dashboard = learningDashboard(await this.vocabulary.snapshot(), now)
      if (dashboard.blockedCards.includes(card.id)) throw new ReviewError('stale-state', '卡片存在复习分支，当前不能继续自动调度。')
      if (!dashboard.queue.some((item) => item.card.id === card.id)) throw new ReviewError('quota', '该语言已停用或今日新卡额度已用完；到期旧卡不受新卡额度限制。')
      if (await db.reviewEvents.where('[cardId+parentStateId]').equals([card.id, card.stateId]).count()) throw new ReviewError('stale-state', '该父状态已经存在评分，已阻止重复或分叉。')
      const settings = await this.vocabulary.getSettings()
      const scheduled = this.adapter.next({ card, rating: command.rating, reviewedAt: now.toISOString(),
        deviceId: await this.vocabulary.getDeviceId(), eventId: command.eventId, resultingStateId: crypto.randomUUID(),
        settingsVersion: settings.revisionId, configuration: defaultConfiguration(settings.desiredRetention) })
      const parentResolution = await db.reviewResolutions.filter((record) => record.cardId === card.id && record.resultingStateId === card.stateId).first()
      const result = { ...scheduled, event: parentResolution ? { ...scheduled.event, parentResolutionId: parentResolution.id } : scheduled.event }
      // Write-only add preserves immutable event history; never put an existing event.
      await db.reviewEvents.add(result.event)
      await db.cards.put(result.card)
      await this.vocabulary.appendPending('append-review', result.event)
      await this.vocabulary.appendPending('upsert-card', result.card)
      return { ...result, repeated: false }
    })
  }
}

export function filterTasks(dashboard: LearningDashboard, language: Language | 'all') {
  return dashboard.queue.filter((item) => language === 'all' || item.entry.lang === language)
}
export function sameCardState(left: Flashcard, right: Flashcard): boolean {
  return left.revisionId === right.revisionId && left.stateId === right.stateId && canonicalJson(left.fsrsState) === canonicalJson(right.fsrsState)
}

import type { DataSnapshot } from '../../domain'
import { canonicalJson } from '../../storage/capture'
import { deserializeFsrs, replayFsrs, serializeFsrs, SCHEDULER_VERSION } from './fsrs-adapter'
import { stateProblem } from './state-validation'

/** Backup boundary: no guessed migration, state repair or historical rescheduling. */
export function validateLearningSnapshot(snapshot: DataSnapshot, allowConflicts = false): void {
  const events = new Map(snapshot.reviewEvents.map((event) => [event.id, event]))
  const reviewedCardIds = new Set(snapshot.reviewEvents.map((event) => event.cardId))
  const activeTemplates = new Set<string>()
  const ignored = new Set(snapshot.reviewResolutions.flatMap((item) => item.ignoredEventIds))
  for (const resolution of snapshot.reviewResolutions) {
    const selected = events.get(resolution.selectedHeadEventId ?? resolution.selectedEventId)!
    if (!selected || canonicalJson(selected.afterState) !== canonicalJson(resolution.resolvedState) || resolution.resultingStateId === selected.resultingStateId) throw new Error('决议状态必须来自选定合法分支，并具有独立状态身份。')
    if (snapshot.reviewResolutions.some((other) => other.id !== resolution.id && other.cardId === resolution.cardId && other.parentStateId === resolution.parentStateId)) throw new Error('同一父状态存在并发决议，必须人工核查，不能组合忽略列表。')
    const directChildren = snapshot.reviewEvents.filter((event) => event.parentReviewEventId === selected.id && !event.parentResolutionId && !ignored.has(event.id))
    if (directChildren.length) throw new Error('决议指向尚有有效后继的旧分支，不能回退进度。')
  }
  for (const card of snapshot.cards) {
    if (card.schedulerVersion !== SCHEDULER_VERSION) throw new Error('备份包含当前客户端不支持的卡片算法版本。')
    const problem = stateProblem(card.fsrsState)
    if (problem) throw new Error(problem)
    if (card.lastReviewEventId) {
      const event = events.get(card.lastReviewEventId)
      const resolution = snapshot.reviewResolutions.find((item) => item.cardId === card.id && item.resultingStateId === card.stateId)
      if (resolution && ((resolution.selectedHeadEventId ?? resolution.selectedEventId) !== event?.id || canonicalJson(resolution.resolvedState) !== canonicalJson(card.fsrsState))) throw new Error('卡片当前状态与决议终点不一致。')
      if (event && (event.schedulerVersion !== card.schedulerVersion || event.settingsVersion !== card.settingsVersion)) throw new Error('卡片参数版本与末次评分不一致。')
      if (!event || (!resolution && (event.resultingStateId !== card.stateId || canonicalJson(event.afterState) !== canonicalJson(card.fsrsState)))) throw new Error('卡片当前状态与末次复习记录不一致，已拒绝恢复。')
      if (!resolution && snapshot.reviewEvents.some((child) => child.parentReviewEventId === card.lastReviewEventId && !ignored.has(child.id))) throw new Error('卡片指向尚有后续评分的旧状态，不能通过恢复回退学习进度。')
    } else if (card.fsrsState.reps > 0 || !card.deletedAt && reviewedCardIds.has(card.id)) throw new Error('卡片进度缺少末次复习事件，不能恢复为可继续调度状态。')
    if (!card.deletedAt) {
      const key = card.vocabularyId + ':' + card.template
      if (!allowConflicts && activeTemplates.has(key)) throw new Error('同一词条模板存在重复卡片，不能猜测合并记忆状态。')
      activeTemplates.add(key)
    }
  }
  for (const event of snapshot.reviewEvents) {
    if (event.schedulerVersion !== SCHEDULER_VERSION || stateProblem(event.beforeState) || stateProblem(event.afterState)) throw new Error('复习事件算法版本或记忆状态不兼容。')
    if (event.beforeState.last_review && Date.parse(event.reviewedAt) <= Date.parse(event.beforeState.last_review)) throw new Error('复习时间早于或等于父状态，已拒绝恢复。')
    const parent = event.parentReviewEventId ? events.get(event.parentReviewEventId) : undefined
    if (event.parentResolutionId ? !snapshot.reviewResolutions.some((resolution) => resolution.id === event.parentResolutionId && resolution.cardId === event.cardId && (resolution.selectedHeadEventId ?? resolution.selectedEventId) === parent?.id && resolution.resultingStateId === event.parentStateId && canonicalJson(resolution.resolvedState) === canonicalJson(event.beforeState)) : parent && canonicalJson(parent.afterState) !== canonicalJson(event.beforeState) || !parent && event.beforeState.reps > 0) throw new Error('复习事件父状态不连续，不能静默重建。')
    const result = replayFsrs(event.beforeState, event.reviewedAt, event.rating, event.configuration)
    if (canonicalJson(result) !== canonicalJson(serializeFsrs(deserializeFsrs(event.afterState)))) throw new Error('复习事件结果与记录的 FSRS 参数不一致，已拒绝恢复。')
  }
}

import type { SerializedFsrsCard } from '../../domain'

/** Extra runtime invariants; structural schema alone does not certify a learned card. */
export function stateProblem(state: SerializedFsrsCard): string | undefined {
  if (state.state === 0) {
    if (state.reps !== 0 || state.lapses !== 0 || state.stability !== 0 || state.difficulty !== 0 || state.learning_steps !== 0 || state.elapsed_days !== 0 || state.scheduled_days !== 0 || state.last_review !== undefined) return '新卡片包含不一致的学习状态。'
  } else if (state.reps < 1 || !state.last_review || state.stability <= 0 || state.difficulty < 1 || Date.parse(state.due) <= Date.parse(state.last_review)) {
    return '已学习卡片缺少有效的记忆状态或下次到期时间。'
  }
  return undefined
}

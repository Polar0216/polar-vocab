import { checkParameters, createEmptyCard, fsrs, generatorParameters, Rating, type Card, type StepUnit } from 'ts-fsrs'
import {
  flashcardSchema, reviewEventSchema, reviewRatingSchema, schedulerConfigurationSchema,
  serializedFsrsCardSchema, utcDateTimeSchema,
  type ReviewRating, type SchedulerConfiguration, type SerializedFsrsCard,
} from '../../domain'
import type { ScheduleRequest, ScheduledReview, SchedulerPort } from './scheduler'
import { stateProblem } from './state-validation'

export const SCHEDULER_VERSION = 'ts-fsrs@5.4.2'

export function serializeFsrs(card: Card): SerializedFsrsCard {
  return serializedFsrsCardSchema.parse({ ...card, due: card.due.toISOString(), last_review: card.last_review?.toISOString() })
}
export function deserializeFsrs(value: SerializedFsrsCard): Card {
  const card = serializedFsrsCardSchema.parse(value)
  return { ...card, due: new Date(card.due), last_review: card.last_review ? new Date(card.last_review) : undefined }
}

/** Refuse silent weight migration/clamping performed by the upstream generator. */
export function parametersFor(configuration: SchedulerConfiguration) {
  const input = schedulerConfigurationSchema.parse(configuration)
  checkParameters(input.weights)
  if (input.weights.length !== 21 || input.maximumInterval > 36500) throw new Error('FSRS 参数版本或最大间隔不受当前调度器支持。')
  for (const steps of [input.learningSteps, input.relearningSteps]) {
    if (steps.some((step) => !/^(?:\d+(?:\.\d+)?)(?:m|h|d)$/.test(step) || !(Number.parseFloat(step) > 0))) throw new Error('FSRS 学习步骤格式不合法。')
  }
  const params = generatorParameters({
    request_retention: input.requestRetention, maximum_interval: input.maximumInterval,
    enable_fuzz: input.enableFuzz, enable_short_term: input.enableShortTerm, w: input.weights,
    learning_steps: input.learningSteps as StepUnit[], relearning_steps: input.relearningSteps as StepUnit[],
  })
  if (params.w.some((weight, index) => weight !== input.weights[index])) throw new Error('FSRS 权重超出当前版本范围，已拒绝自动改写。')
  // The actual scheduler also checks retention and the complete parameter set.
  fsrs(params)
  return params
}

export function defaultConfiguration(retention = 0.9): SchedulerConfiguration {
  if (!(retention > 0 && retention < 1)) throw new Error('目标保持率必须在 0 与 1 之间。')
  const params = generatorParameters({ request_retention: retention })
  const configuration = schedulerConfigurationSchema.parse({
    requestRetention: params.request_retention, maximumInterval: params.maximum_interval,
    enableFuzz: params.enable_fuzz, enableShortTerm: params.enable_short_term,
    weights: [...params.w], learningSteps: [...params.learning_steps], relearningSteps: [...params.relearning_steps],
  })
  parametersFor(configuration)
  return configuration
}

/** The same deterministic operation is used for live scores and backup verification. */
export function replayFsrs(state: SerializedFsrsCard, reviewedAt: string, rating: ReviewRating, configuration: SchedulerConfiguration): SerializedFsrsCard {
  const time = utcDateTimeSchema.parse(reviewedAt)
  const grade = reviewRatingSchema.parse(rating)
  const result = fsrs(parametersFor(configuration)).next(deserializeFsrs(state), time, Rating[grade])
  return serializeFsrs(result.card)
}

export class FsrsAdapter implements SchedulerPort {
  readonly schedulerVersion = SCHEDULER_VERSION
  empty(now: string): SerializedFsrsCard { return serializeFsrs(createEmptyCard(utcDateTimeSchema.parse(now))) }
  next(request: ScheduleRequest): ScheduledReview {
    const current = flashcardSchema.parse(request.card)
    const problem = stateProblem(current.fsrsState)
    if (problem) throw new Error(problem)
    if (current.schedulerVersion !== this.schedulerVersion) throw new Error('卡片算法版本不兼容，请保留备份后升级。')
    const time = utcDateTimeSchema.parse(request.reviewedAt)
    const rating = reviewRatingSchema.parse(request.rating)
    const configuration = schedulerConfigurationSchema.parse(request.configuration)
    const state = replayFsrs(current.fsrsState, time, rating, configuration)
    const event = reviewEventSchema.parse({
      id: request.eventId, schemaVersion: 1, cardId: current.id, deviceId: request.deviceId,
      parentStateId: current.stateId, resultingStateId: request.resultingStateId,
      parentReviewEventId: current.lastReviewEventId ?? null, reviewedAt: time, rating,
      schedulerVersion: this.schedulerVersion, settingsVersion: request.settingsVersion, configuration,
      beforeState: current.fsrsState, afterState: state,
    })
    const card = flashcardSchema.parse({ ...current, fsrsState: state, stateId: request.resultingStateId,
      lastReviewEventId: event.id, revisionId: crypto.randomUUID(), parentRevisionIds: [current.revisionId],
      updatedAt: time, schedulerVersion: this.schedulerVersion, settingsVersion: request.settingsVersion })
    return { card, event }
  }
}

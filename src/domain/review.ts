import type { Card } from 'ts-fsrs';
import { z } from 'zod';
import { nonBlankText, recordFields, schemaVersionSchema, utcDateTimeSchema, uuidSchema, validateRevision } from './common';

/** ts-fsrs 5.4.2 Card with JSON-safe UTC dates, shared by storage, backup and adapter. */
export type SerializedFsrsCard = Omit<Card, 'due' | 'last_review'> & { due: string; last_review?: string };

export const serializedFsrsCardSchema: z.ZodType<SerializedFsrsCard> = z.strictObject({
  due: utcDateTimeSchema,
  stability: z.number().min(0),
  difficulty: z.number().min(0).max(10),
  elapsed_days: z.number().min(0),
  scheduled_days: z.number().min(0),
  learning_steps: z.number().int().min(0),
  reps: z.number().int().min(0),
  lapses: z.number().int().min(0),
  state: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  last_review: utcDateTimeSchema.optional(),
});

export const schedulerConfigurationSchema = z.strictObject({
  requestRetention: z.number().gt(0).lt(1),
  maximumInterval: z.number().int().positive(),
  enableFuzz: z.boolean(),
  enableShortTerm: z.boolean(),
  weights: z.array(z.number()).min(1),
  learningSteps: z.array(nonBlankText(40)),
  relearningSteps: z.array(nonBlankText(40)),
});

export const reviewRatingSchema = z.enum(['Again', 'Hard', 'Good', 'Easy']);
export const flashcardSchema = z.strictObject({
  ...recordFields,
  vocabularyId: uuidSchema,
  template: z.enum(['meaning', 'article', 'reverse', 'spelling']),
  suspended: z.boolean(),
  stateId: uuidSchema,
  lastReviewEventId: uuidSchema.nullable().optional(),
  fsrsState: serializedFsrsCardSchema,
  schedulerVersion: nonBlankText(100),
  settingsVersion: uuidSchema,
}).superRefine(validateRevision);

export const reviewEventSchema = z.strictObject({
  id: uuidSchema,
  schemaVersion: schemaVersionSchema,
  cardId: uuidSchema,
  deviceId: uuidSchema,
  parentStateId: uuidSchema,
  resultingStateId: uuidSchema,
  parentReviewEventId: uuidSchema.nullable().optional(),
  parentResolutionId: uuidSchema.optional(),
  reviewedAt: utcDateTimeSchema,
  rating: reviewRatingSchema,
  schedulerVersion: nonBlankText(100),
  settingsVersion: uuidSchema,
  configuration: schedulerConfigurationSchema,
  beforeState: serializedFsrsCardSchema,
  afterState: serializedFsrsCardSchema,
}).superRefine((record, context) => {
  if (record.parentStateId === record.resultingStateId) {
    context.addIssue({ code: 'custom', path: ['resultingStateId'], message: '复习必须产生新的调度状态 ID' });
  }
  if (record.parentReviewEventId === record.id) {
    context.addIssue({ code: 'custom', path: ['parentReviewEventId'], message: '复习事件不能引用自身' });
  }
});

export const reviewResolutionSchema = z.strictObject({
  id: uuidSchema,
  schemaVersion: schemaVersionSchema,
  conflictId: uuidSchema,
  cardId: uuidSchema,
  deviceId: uuidSchema,
  createdAt: utcDateTimeSchema,
  parentStateId: uuidSchema,
  selectedEventId: uuidSchema,
  selectedHeadEventId: uuidSchema.optional(),
  ignoredEventIds: z.array(uuidSchema).min(1),
  resultingStateId: uuidSchema,
  resolvedState: serializedFsrsCardSchema,
  reason: nonBlankText(2_000).optional(),
}).superRefine((record, context) => {
  if (record.ignoredEventIds.includes(record.selectedEventId)) {
    context.addIssue({ code: 'custom', path: ['ignoredEventIds'], message: '有效分支不能同时被忽略' });
  }
  if (new Set(record.ignoredEventIds).size !== record.ignoredEventIds.length) {
    context.addIssue({ code: 'custom', path: ['ignoredEventIds'], message: '被忽略的事件 ID 不可重复' });
  }
  if (record.parentStateId === record.resultingStateId) {
    context.addIssue({ code: 'custom', path: ['resultingStateId'], message: '决议必须产生新的调度状态 ID' });
  }
});

export type SchedulerConfiguration = z.infer<typeof schedulerConfigurationSchema>;
export type ReviewRating = z.infer<typeof reviewRatingSchema>;
export type Flashcard = z.infer<typeof flashcardSchema>;
export type ReviewEvent = Readonly<z.infer<typeof reviewEventSchema>>;
export type ReviewResolution = Readonly<z.infer<typeof reviewResolutionSchema>>;

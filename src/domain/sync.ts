import { z } from 'zod';
import { nonBlankText, recordFields, schemaVersionSchema, utcDateTimeSchema, uuidSchema, validateRevision } from './common';
import { appSettingsSchema } from './settings';
import { flashcardSchema, reviewEventSchema, reviewResolutionSchema } from './review';
import { captureEventSchema, vocabularyEntrySchema } from './vocabulary';

export const tombstoneSchema = z.strictObject({
  ...recordFields,
  entityType: z.enum(['vocabulary', 'card']),
  entityId: uuidSchema,
  deviceId: uuidSchema,
  deletedAt: utcDateTimeSchema,
}).superRefine(validateRevision);

export const syncStatusSchema = z.enum(['unconfigured', 'idle', 'pending', 'syncing', 'synced', 'conflict', 'error']);
export const syncMetadataSchema = z.strictObject({
  id: uuidSchema,
  schemaVersion: schemaVersionSchema,
  deviceId: uuidSchema,
  status: syncStatusSchema,
  baseSnapshotId: uuidSchema.nullable(),
  remoteSha: z.string().regex(/^[0-9a-f]{40}$/i).nullable(),
  lastSyncedAt: utcDateTimeSchema.nullable(),
  updatedAt: utcDateTimeSchema,
  lastErrorCode: z.enum(['offline', 'unauthorized', 'forbidden', 'rate-limited', 'sha-conflict', 'incompatible-schema', 'invalid-data', 'unknown']).optional(),
});

const pendingFields = {
  id: uuidSchema,
  schemaVersion: schemaVersionSchema,
  deviceId: uuidSchema,
  createdAt: utcDateTimeSchema,
  baseSnapshotId: uuidSchema.nullable(),
};

export const pendingOperationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...pendingFields, kind: z.literal('upsert-vocabulary'), payload: vocabularyEntrySchema }),
  z.strictObject({ ...pendingFields, kind: z.literal('upsert-card'), payload: flashcardSchema }),
  z.strictObject({ ...pendingFields, kind: z.literal('delete-record'), payload: tombstoneSchema }),
  z.strictObject({ ...pendingFields, kind: z.literal('append-review'), payload: reviewEventSchema }),
  z.strictObject({ ...pendingFields, kind: z.literal('append-capture'), payload: captureEventSchema }),
  z.strictObject({ ...pendingFields, kind: z.literal('resolve-review'), payload: reviewResolutionSchema }),
  z.strictObject({ ...pendingFields, kind: z.literal('update-settings'), payload: appSettingsSchema }),
]);

export const conflictRecordSchema = z.union([
  vocabularyEntrySchema, flashcardSchema, appSettingsSchema, reviewEventSchema, captureEventSchema, tombstoneSchema, reviewResolutionSchema,
]);

export const syncConflictSchema = z.strictObject({
  id: uuidSchema,
  schemaVersion: schemaVersionSchema,
  createdAt: utcDateTimeSchema,
  entityType: z.enum(['vocabulary', 'card', 'settings', 'review-event', 'capture', 'tombstone', 'review-resolution']),
  entityId: uuidSchema,
  kind: z.enum(['field', 'delete-vs-edit', 'review-branch', 'immutable-id']),
  fields: z.array(nonBlankText(200)),
  base: conflictRecordSchema.nullable(),
  local: conflictRecordSchema.nullable(),
  remote: conflictRecordSchema.nullable(),
});

export const dataSnapshotSchema = z.strictObject({
  id: uuidSchema,
  schemaVersion: schemaVersionSchema,
  exportedAt: utcDateTimeSchema,
  vocabularies: z.array(vocabularyEntrySchema),
  cards: z.array(flashcardSchema),
  reviewEvents: z.array(reviewEventSchema),
  captures: z.array(captureEventSchema),
  tombstones: z.array(tombstoneSchema),
  reviewResolutions: z.array(reviewResolutionSchema),
  ingestedCaptureIds: z.array(uuidSchema),
  settings: appSettingsSchema,
}).superRefine((snapshot, context) => {
  const collections = ['vocabularies', 'cards', 'reviewEvents', 'captures', 'tombstones', 'reviewResolutions'] as const;
  for (const name of collections) {
    const ids = snapshot[name].map((record) => record.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', path: [name], message: '同一集合的记录 ID 不可重复，包括同 ID 不同内容' });
    }
  }
  if (new Set(snapshot.ingestedCaptureIds).size !== snapshot.ingestedCaptureIds.length) {
    context.addIssue({ code: 'custom', path: ['ingestedCaptureIds'], message: '已摄取 ID 不可重复' });
  }
  const vocabularyMap = new Map(snapshot.vocabularies.map((record) => [record.id, record]));
  const cardMap = new Map(snapshot.cards.map((record) => [record.id, record]));
  const reviewMap = new Map(snapshot.reviewEvents.map((record) => [record.id, record]));
  const captureIds = new Set(snapshot.captures.map((record) => record.id));
  const requireReference = (valid: boolean, path: (string | number)[], message: string) => {
    if (!valid) context.addIssue({ code: 'custom', path, message });
  };
  const resultingIds = [...snapshot.reviewEvents.map((event) => event.resultingStateId), ...snapshot.reviewResolutions.map((record) => record.resultingStateId)];
  requireReference(new Set(resultingIds).size === resultingIds.length, ['reviewEvents'], '不同事件或决议不能产生相同调度状态身份');
  const stateOwners = new Map<string, string>();
  const ownState = (stateId: string, cardId: string) => { requireReference(!stateOwners.has(stateId) || stateOwners.get(stateId) === cardId, ['cards'], '调度状态不能跨卡片共享'); stateOwners.set(stateId, cardId); };
  snapshot.cards.forEach((card) => ownState(card.stateId, card.id));
  snapshot.reviewEvents.forEach((event) => { ownState(event.parentStateId, event.cardId); ownState(event.resultingStateId, event.cardId); });
  snapshot.reviewResolutions.forEach((record) => { ownState(record.parentStateId, record.cardId); ownState(record.resultingStateId, record.cardId); });
  snapshot.cards.forEach((card, index) => {
    requireReference(vocabularyMap.has(card.vocabularyId), ['cards', index, 'vocabularyId'], '卡片引用的词条不存在');
    if (card.lastReviewEventId) {
      requireReference(reviewMap.get(card.lastReviewEventId)?.cardId === card.id, ['cards', index, 'lastReviewEventId'], '末次复习事件不属于此卡片');
    }
  });
  snapshot.reviewEvents.forEach((event, index) => {
    requireReference(cardMap.has(event.cardId), ['reviewEvents', index, 'cardId'], '复习引用的卡片不存在');
    if (event.parentReviewEventId) {
      const parent = reviewMap.get(event.parentReviewEventId);
      const resolution = snapshot.reviewResolutions.find((record) => record.id === event.parentResolutionId);
      requireReference(parent?.cardId === event.cardId && (event.parentResolutionId ? resolution?.cardId === event.cardId && (resolution.selectedHeadEventId ?? resolution.selectedEventId) === parent.id && resolution.resultingStateId === event.parentStateId : parent.resultingStateId === event.parentStateId), ['reviewEvents', index, 'parentReviewEventId'], '父复习事件与卡片或调度父状态不匹配');
    }
    if (event.parentResolutionId) requireReference(Boolean(event.parentReviewEventId), ['reviewEvents', index, 'parentResolutionId'], '决议后评分必须引用选定事件');
  });
  snapshot.ingestedCaptureIds.forEach((id, index) => {
    requireReference(captureIds.has(id), ['ingestedCaptureIds', index], '已摄取 ID 必须保留原始 CaptureEvent 以核查重复内容');
  });
  snapshot.reviewResolutions.forEach((resolution, index) => {
    const selected = reviewMap.get(resolution.selectedEventId);
    requireReference(cardMap.has(resolution.cardId), ['reviewResolutions', index, 'cardId'], '决议引用的卡片不存在');
    requireReference(selected?.cardId === resolution.cardId && selected.parentStateId === resolution.parentStateId, ['reviewResolutions', index, 'selectedEventId'], '有效分支不属于此次卡片父状态');
    const branchRoot = (id: string) => {
      const seen = new Set<string>(); let event = reviewMap.get(id);
      while (event && event.parentStateId !== resolution.parentStateId && event.parentReviewEventId && !seen.has(event.id)) { seen.add(event.id); event = reviewMap.get(event.parentReviewEventId); }
      return event?.parentStateId === resolution.parentStateId ? event : undefined;
    };
    if (resolution.selectedHeadEventId) requireReference(branchRoot(resolution.selectedHeadEventId)?.id === selected?.id, ['reviewResolutions', index, 'selectedHeadEventId'], '选定终点必须属于有效分支');
    resolution.ignoredEventIds.forEach((id, eventIndex) => {
      const ignored = reviewMap.get(id);
      requireReference(ignored?.cardId === resolution.cardId && Boolean(branchRoot(id)) && branchRoot(id)?.id !== selected?.id, ['reviewResolutions', index, 'ignoredEventIds', eventIndex], '忽略的分支不属于此次卡片父状态或来自有效分支');
    });
  });
  snapshot.tombstones.forEach((tombstone, index) => {
    const target = tombstone.entityType === 'vocabulary'
      ? vocabularyMap.get(tombstone.entityId)
      : cardMap.get(tombstone.entityId);
    requireReference(!target || Boolean(target.deletedAt), ['tombstones', index, 'entityId'], '删除标记不能与活跃对象并存');
  });
  const tombstoneTargets = new Set(snapshot.tombstones.map((record) => `${record.entityType}:${record.entityId}`));
  snapshot.vocabularies.forEach((record, index) => {
    if (record.deletedAt) {
      requireReference(tombstoneTargets.has(`vocabulary:${record.id}`), ['vocabularies', index, 'deletedAt'], '已删除词条必须保留对应删除标记');
    }
  });
  snapshot.cards.forEach((record, index) => {
    if (record.deletedAt) {
      requireReference(tombstoneTargets.has(`card:${record.id}`), ['cards', index, 'deletedAt'], '已删除卡片必须保留对应删除标记');
    }
  });
});

export type Tombstone = z.infer<typeof tombstoneSchema>;
export type SyncStatus = z.infer<typeof syncStatusSchema>;
export type SyncMetadata = z.infer<typeof syncMetadataSchema>;
export type PendingOperation = z.infer<typeof pendingOperationSchema>;
export type SyncConflict = z.infer<typeof syncConflictSchema>;
export type DataSnapshot = z.infer<typeof dataSnapshotSchema>;
export type Snapshot = DataSnapshot;

import { describe, expect, it } from 'vitest';
import { appSettingsSchema, captureEventSchema, dataSnapshotSchema, flashcardSchema, pendingOperationSchema, reviewEventSchema, reviewResolutionSchema, serializedFsrsCardSchema, syncConflictSchema, syncMetadataSchema, vocabularyEntrySchema } from '../../../src/domain';
import { capture, card, fsrsState, id, now, resolution, review, settings, snapshot, vocabulary } from './fixtures';

describe('VocabularyEntry and CaptureEvent protocol', () => {
  it('accepts an inbox word without meanings, context, tags or cards', () => {
    expect(vocabularyEntrySchema.parse(vocabulary())).toEqual(vocabulary());
    expect(dataSnapshotSchema.parse(snapshot()).cards).toEqual([]);
  });

  it('preserves German noun spelling, article, plural and structured conjugations', () => {
    const data = {
      ...vocabulary(), lang: 'de', lemma: 'Entscheidung',
      de: { article: 'die', plural: 'Entscheidungen', conjugations: [{ tense: 'Präsens', person: 'ich', form: 'entscheide' }] },
    };
    expect(vocabularyEntrySchema.parse(data)).toEqual(data);
  });

  it('allows optional English phonetics and inflections', () => {
    expect(vocabularyEntrySchema.safeParse({ ...vocabulary(), en: { phonetic: '/ɪɡˈzɑːmpəl/', inflections: ['examples'] } }).success).toBe(true);
  });

  it('keeps a source without inventing a context sentence', () => {
    expect(vocabularyEntrySchema.parse({ ...vocabulary(), source: '人工来源示例' }).source).toBe('人工来源示例');
    expect(captureEventSchema.safeParse({ ...capture(), payload: { ...capture().payload, source: '人工来源示例' } }).success).toBe(true);
  });

  it.each([
    ['future schema', { schemaVersion: 2 }],
    ['unsupported language', { lang: 'fr' }],
    ['invalid record UUID', { id: 'example' }],
    ['invalid revision UUID', { revisionId: 'revision-one' }],
    ['invalid time', { createdAt: 'yesterday' }],
    ['impossible date', { createdAt: '2026-02-30T00:00:00Z' }],
    ['time without zone', { createdAt: '2026-10-13T14:00:00' }],
    ['noncanonical offset', { createdAt: '2026-10-13T22:00:00+08:00' }],
    ['blank lemma', { lemma: '   ' }],
    ['missing lemma', { lemma: undefined }],
    ['incorrect meanings type', { meanings: 'a meaning' }],
    ['unknown credential field', { token: 'unexpected-field' }],
    ['German extension on English', { de: { article: 'die' } }],
    ['unsafe audio URL', { en: { pronunciationUrl: 'javascript:alert(1)' } }],
    ['self parent revision', { parentRevisionIds: [id(11)] }],
    ['duplicate parent revision', { parentRevisionIds: [id(12), id(12)] }],
  ])('rejects %s', (_label, patch) => {
    expect(vocabularyEntrySchema.safeParse({ ...vocabulary(), ...patch }).success).toBe(false);
  });

  it('rejects English extension on German and an invalid German article', () => {
    expect(vocabularyEntrySchema.safeParse({ ...vocabulary(), lang: 'de', en: {} }).success).toBe(false);
    expect(vocabularyEntrySchema.safeParse({ ...vocabulary(), lang: 'de', de: { article: 'a' } }).success).toBe(false);
  });

  it('rejects duplicate context IDs', () => {
    const context = { id: id(60), text: 'An artificial example.' };
    expect(vocabularyEntrySchema.safeParse({ ...vocabulary(), contexts: [context, context] }).success).toBe(false);
  });

  it('shares the same strict minimal capture payload between Windows and PWA', () => {
    expect(captureEventSchema.parse(capture()).payload).toEqual({ lang: 'de', lemma: 'Beispiel' });
    expect(captureEventSchema.safeParse({ ...capture(), deviceId: 'windows-laptop' }).success).toBe(false);
    expect(captureEventSchema.safeParse({ ...capture(), payload: { lang: 'de', lemma: 'Beispiel', en: {} } }).success).toBe(false);
  });

  it('rejects repeated context IDs within capture payloads even when their texts differ', () => {
    const context = { id: id(60), text: 'An artificial example.' };
    const payload = { ...capture().payload, contexts: [context, { ...context, text: 'A different artificial example.' }] };
    expect(captureEventSchema.safeParse({ ...capture(), payload }).success).toBe(false);
  });

  it('accepts distinct context IDs through the shared vocabulary and capture boundary', () => {
    const contexts = [{ id: id(60), text: 'First artificial example.' }, { id: id(61), text: 'Second artificial example.' }];
    expect(vocabularyEntrySchema.safeParse({ ...vocabulary(), contexts }).success).toBe(true);
    expect(captureEventSchema.safeParse({ ...capture(), payload: { ...capture().payload, contexts } }).success).toBe(true);
  });
});

describe('review protocol (validation only; no scheduler)', () => {
  it('retains the complete JSON-safe Card contract of ts-fsrs 5.4.2', () => {
    expect(flashcardSchema.parse(card()).fsrsState).toEqual(fsrsState());
    expect(serializedFsrsCardSchema.safeParse({ ...fsrsState(), due: new Date(now) }).success).toBe(false);
    const incomplete = { ...fsrsState(), learning_steps: undefined };
    expect(serializedFsrsCardSchema.safeParse(incomplete).success).toBe(false);
  });

  it.each(['Again', 'Hard', 'Good', 'Easy'])('accepts the %s rating', (rating) => {
    expect(reviewEventSchema.safeParse({ ...review(), rating }).success).toBe(true);
  });

  it('preserves event IDs and both state snapshots without a mutable resolution field', () => {
    expect(reviewEventSchema.parse(review())).toEqual(review());
    expect(reviewEventSchema.safeParse({ ...review(), resolution: 'effective' }).success).toBe(false);
    expect(reviewEventSchema.safeParse({ ...review(), rating: 'Pass' }).success).toBe(false);
    expect(reviewEventSchema.safeParse({ ...review(), resultingStateId: review().parentStateId }).success).toBe(false);
    expect(reviewEventSchema.safeParse({ ...review(), parentReviewEventId: review().id }).success).toBe(false);
  });

  it('rejects negative counters, out-of-range state and nonfinite parameters', () => {
    expect(serializedFsrsCardSchema.safeParse({ ...fsrsState(), reps: -1 }).success).toBe(false);
    expect(serializedFsrsCardSchema.safeParse({ ...fsrsState(), state: 4 }).success).toBe(false);
    expect(serializedFsrsCardSchema.safeParse({ ...fsrsState(), stability: Infinity }).success).toBe(false);
    expect(serializedFsrsCardSchema.safeParse({ ...fsrsState(), difficulty: 11 }).success).toBe(false);
  });

  it('keeps resolutions separate and rejects a branch chosen and ignored simultaneously', () => {
    expect(reviewResolutionSchema.parse(resolution())).toEqual(resolution());
    expect(reviewResolutionSchema.safeParse({ ...resolution(), ignoredEventIds: [id(40)] }).success).toBe(false);
    expect(reviewResolutionSchema.safeParse({ ...resolution(), ignoredEventIds: [] }).success).toBe(false);
  });
});

describe('snapshot referential integrity and forward compatibility', () => {
  it('accepts a complete snapshot with an immutable review branch and resolution', () => {
    const data = snapshot();
    data.cards = [card()];
    data.reviewEvents = [review(), { ...review(), id: id(42), resultingStateId: id(43), deviceId: id(4), rating: 'Hard' }];
    data.reviewResolutions = [resolution()];
    data.captures = [capture()];
    data.ingestedCaptureIds = [capture().id];
    expect(dataSnapshotSchema.parse(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });

  it('rejects duplicate record IDs even when the contents differ', () => {
    const data = snapshot();
    data.vocabularies.push({ ...vocabulary(), lemma: 'changed' });
    expect(dataSnapshotSchema.safeParse(data).success).toBe(false);
    const captures = snapshot();
    captures.captures = [capture(), { ...capture(), payload: { lang: 'en', lemma: 'different' } }];
    expect(dataSnapshotSchema.safeParse(captures).success).toBe(false);
  });

  it('rejects missing vocabulary and review card references', () => {
    expect(dataSnapshotSchema.safeParse({ ...snapshot(), cards: [{ ...card(), vocabularyId: id(999) }] }).success).toBe(false);
    expect(dataSnapshotSchema.safeParse({ ...snapshot(), reviewEvents: [review()] }).success).toBe(false);
  });

  it('rejects a parent event whose resulting state is not the child parent state', () => {
    const child = { ...review(), id: id(42), parentReviewEventId: id(40), resultingStateId: id(43) };
    expect(dataSnapshotSchema.safeParse({ ...snapshot(), cards: [card()], reviewEvents: [review(), child] }).success).toBe(false);
  });

  it('requires raw captures for ingested IDs and rejects duplicated ingested IDs', () => {
    expect(dataSnapshotSchema.safeParse({ ...snapshot(), ingestedCaptureIds: [id(30)] }).success).toBe(false);
    expect(dataSnapshotSchema.safeParse({ ...snapshot(), captures: [capture()], ingestedCaptureIds: [id(30), id(30)] }).success).toBe(false);
  });

  it('rejects missing or unrelated review resolution references', () => {
    expect(dataSnapshotSchema.safeParse({ ...snapshot(), cards: [card()], reviewEvents: [review()], reviewResolutions: [resolution()] }).success).toBe(false);
  });

  it('keeps tombstones and rejects coexistence with an active record', () => {
    const tombstone = {
      id: id(70), schemaVersion: 1 as const, revisionId: id(71), parentRevisionIds: [id(11)], createdAt: now, updatedAt: now,
      entityType: 'vocabulary' as const, entityId: id(10), deviceId: id(3), deletedAt: now,
    };
    expect(dataSnapshotSchema.safeParse({ ...snapshot(), tombstones: [tombstone] }).success).toBe(false);
    expect(dataSnapshotSchema.safeParse({ ...snapshot(), vocabularies: [{ ...vocabulary(), deletedAt: now }], tombstones: [tombstone] }).success).toBe(true);
    expect(dataSnapshotSchema.safeParse({ ...snapshot(), vocabularies: [], tombstones: [tombstone] }).success).toBe(true);
    expect(dataSnapshotSchema.safeParse({ ...snapshot(), vocabularies: [], tombstones: [tombstone, { ...tombstone, id: id(72), revisionId: id(73), deviceId: id(4) }] }).success).toBe(true);
  });

  it.each(['vocabulary', 'card'] as const)('requires a matching tombstone for a deleted %s', (entityType) => {
    const data = snapshot();
    if (entityType === 'vocabulary') data.vocabularies = [{ ...vocabulary(), deletedAt: now }];
    else data.cards = [{ ...card(), deletedAt: now }];
    expect(dataSnapshotSchema.safeParse(data).success).toBe(false);
  });

  it('does not let a tombstone for another entity type satisfy the deletion requirement', () => {
    const tombstone = {
      id: id(70), schemaVersion: 1 as const, revisionId: id(71), parentRevisionIds: [id(11)], createdAt: now, updatedAt: now,
      entityType: 'card' as const, entityId: id(10), deviceId: id(3), deletedAt: now,
    };
    expect(dataSnapshotSchema.safeParse({ ...snapshot(), vocabularies: [{ ...vocabulary(), deletedAt: now }], tombstones: [tombstone] }).success).toBe(false);
  });

  it('accepts a soft deleted card with a matching tombstone and retains its vocabulary reference', () => {
    const tombstone = {
      id: id(70), schemaVersion: 1 as const, revisionId: id(71), parentRevisionIds: [id(21)], createdAt: now, updatedAt: now,
      entityType: 'card' as const, entityId: id(20), deviceId: id(3), deletedAt: now,
    };
    expect(dataSnapshotSchema.safeParse({ ...snapshot(), cards: [{ ...card(), deletedAt: now }], tombstones: [tombstone] }).success).toBe(true);
  });

  it('rejects future snapshots before they can be written', () => {
    expect(dataSnapshotSchema.safeParse({ ...snapshot(), schemaVersion: 2 }).success).toBe(false);
  });
});

describe('settings and local sync bookkeeping', () => {
  it('validates limits and excludes credentials from settings', () => {
    expect(appSettingsSchema.parse(settings())).toEqual(settings());
    expect(appSettingsSchema.safeParse({ ...settings(), desiredRetention: 1 }).success).toBe(false);
    expect(appSettingsSchema.safeParse({ ...settings(), dailyNew: { en: -1, de: 5 } }).success).toBe(false);
    expect(appSettingsSchema.safeParse({ ...settings(), githubToken: 'unexpected-field' }).success).toBe(false);
  });

  it('validates unconfigured and confirmed metadata without API credentials', () => {
    const data = { id: id(80), schemaVersion: 1, deviceId: id(3), status: 'unconfigured', baseSnapshotId: null, remoteSha: null, lastSyncedAt: null, updatedAt: now };
    expect(syncMetadataSchema.safeParse(data).success).toBe(true);
    expect(syncMetadataSchema.safeParse({ ...data, remoteSha: 'not-a-sha' }).success).toBe(false);
    expect(syncMetadataSchema.safeParse({ ...data, token: 'unexpected-field' }).success).toBe(false);
  });

  it('uses typed pending payloads instead of arbitrary mutation JSON', () => {
    const data = { id: id(90), schemaVersion: 1, deviceId: id(3), createdAt: now, baseSnapshotId: null, kind: 'upsert-vocabulary', payload: vocabulary() };
    expect(pendingOperationSchema.safeParse(data).success).toBe(true);
    expect(pendingOperationSchema.safeParse({ ...data, kind: 'append-review' }).success).toBe(false);
    expect(pendingOperationSchema.safeParse({ ...data, kind: 'replace-database' }).success).toBe(false);
  });

  it('retains typed base/local/remote conflict copies', () => {
    const data = {
      id: id(91), schemaVersion: 1, createdAt: now, entityType: 'vocabulary', entityId: id(10), kind: 'field', fields: ['meanings'],
      base: vocabulary(), local: { ...vocabulary(), meanings: ['本地测试'] }, remote: { ...vocabulary(), meanings: ['远端测试'] },
    };
    expect(syncConflictSchema.safeParse(data).success).toBe(true);
    expect(syncConflictSchema.safeParse({ ...data, local: { arbitrary: true } }).success).toBe(false);
  });
});

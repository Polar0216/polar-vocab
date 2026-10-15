import type { AppSettings, CaptureEvent, DataSnapshot, Flashcard, ReviewEvent, ReviewResolution, SerializedFsrsCard, VocabularyEntry } from '../../../src/domain';
import { createEmptyCard, default_w, fsrs, Rating } from 'ts-fsrs';

// Artificial protocol fixtures only; these are not a person's vocabulary or history.
export const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
export const now = '2026-10-13T14:00:00.000Z';

export function settings(): AppSettings {
  return {
    id: id(1), schemaVersion: 1, revisionId: id(2), parentRevisionIds: [], createdAt: now, updatedAt: now,
    theme: 'system', dailyNew: { en: 10, de: 5 }, reviewEnabled: { en: true, de: true }, desiredRetention: 0.9,
  };
}

export function vocabulary(): VocabularyEntry {
  return {
    id: id(10), schemaVersion: 1, revisionId: id(11), parentRevisionIds: [], createdAt: now, updatedAt: now,
    lang: 'en', lemma: 'example', origin: 'manual', status: 'inbox',
  };
}

export function fsrsState(): SerializedFsrsCard {
  return { due: now, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0 };
}

export function card(): Flashcard {
  return {
    id: id(20), schemaVersion: 1, revisionId: id(21), parentRevisionIds: [], createdAt: now, updatedAt: now,
    vocabularyId: id(10), template: 'meaning', suspended: false, stateId: id(22), fsrsState: fsrsState(),
    schedulerVersion: 'ts-fsrs@5.4.2', settingsVersion: id(2),
  };
}

export function capture(): CaptureEvent {
  return { id: id(30), schemaVersion: 1, deviceId: id(3), capturedAt: now, origin: 'windows', payload: { lang: 'de', lemma: 'Beispiel' } };
}

export function review(): ReviewEvent {
  const { due, last_review, ...state } = fsrs().next(createEmptyCard(now), now, Rating.Good).card;
  return {
    id: id(40), schemaVersion: 1, cardId: id(20), deviceId: id(3), parentStateId: id(22), resultingStateId: id(41), reviewedAt: now,
    rating: 'Good', schedulerVersion: 'ts-fsrs@5.4.2', settingsVersion: id(2),
    configuration: { requestRetention: 0.9, maximumInterval: 36_500, enableFuzz: false, enableShortTerm: true, weights: [...default_w], learningSteps: ['1m', '10m'], relearningSteps: ['10m'] },
    beforeState: fsrsState(), afterState: { ...state, due: due.toISOString(), last_review: last_review?.toISOString() },
  };
}

export function resolution(): ReviewResolution {
  return {
    id: id(50), schemaVersion: 1, conflictId: id(51), cardId: id(20), deviceId: id(3), createdAt: now,
    parentStateId: id(22), selectedEventId: id(40), ignoredEventIds: [id(42)], resultingStateId: id(52), resolvedState: review().afterState,
  };
}

export function snapshot(): DataSnapshot {
  return {
    id: id(100), schemaVersion: 1, exportedAt: now, vocabularies: [vocabulary()], cards: [], reviewEvents: [],
    captures: [], tombstones: [], reviewResolutions: [], ingestedCaptureIds: [], settings: settings(),
  };
}

import type { Flashcard, ReviewEvent, ReviewRating, SchedulerConfiguration, UUID } from '../../domain';

export interface ScheduleRequest {
  readonly card: Flashcard;
  readonly rating: ReviewRating;
  readonly reviewedAt: string;
  readonly deviceId: UUID;
  readonly eventId: UUID;
  readonly resultingStateId: UUID;
  readonly settingsVersion: UUID;
  readonly configuration: SchedulerConfiguration;
}

export interface ScheduledReview {
  readonly card: Flashcard;
  readonly event: ReviewEvent;
}

/** The adapter alone executes ts-fsrs; UI and persistence use this boundary. */
export interface SchedulerPort {
  readonly schedulerVersion: string;
  next(request: ScheduleRequest): ScheduledReview;
}

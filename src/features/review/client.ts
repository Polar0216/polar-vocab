import type { LocalVocabularyService } from '../vocabulary/service'
import type { LocalReviewService } from './service'

const services = new WeakMap<LocalVocabularyService, Promise<LocalReviewService>>()
/** Keep the algorithm outside the initial home bundle; load on explicit card/study use. */
export function loadReviewService(vocabulary: LocalVocabularyService): Promise<LocalReviewService> {
  let pending = services.get(vocabulary)
  if (!pending) {
    pending = import('./service').then(({ LocalReviewService }) => new LocalReviewService(vocabulary))
    services.set(vocabulary, pending)
    void pending.catch(() => services.delete(vocabulary))
  }
  return pending
}

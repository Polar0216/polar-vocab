// The existing domain schemas remain the single source of truth for both clients.
export { captureEventSchema, vocabularyPayloadSchema, germanFieldsSchema, payloadRequiresProtocol2 } from '../../src/domain/vocabulary'
export type { CaptureEvent, VocabularyPayload, GermanFields } from '../../src/domain/vocabulary'
export { languageSchema, uuidSchema } from '../../src/domain/common'
export type { Language } from '../../src/domain/common'
export { canonicalJson, entryFromCapture, CAPTURE_NAMESPACE } from '../../src/storage/capture'
export * from './capture-batch'
export * from '../../src/domain/lexicon'
export * from './lexicon'

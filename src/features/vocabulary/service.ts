import { z } from 'zod'
import {
  appSettingsSchema, captureEventSchema, dataSnapshotSchema, flashcardSchema, languageSchema, originSchema,
  pendingOperationSchema, reviewEventSchema, reviewResolutionSchema, syncConflictSchema, syncMetadataSchema,
  tombstoneSchema, utcDateTimeSchema, uuidSchema, vocabularyEntrySchema, vocabularyPayloadSchema,
  type AppSettings, type CaptureEvent, type CaptureOrigin, type DataSnapshot, type Language, type PendingOperation,
  type SyncMetadata, type UUID, type VocabularyEntry, type VocabularyPayload,
} from '../../domain'
import { PolarDatabase } from '../../storage/database'
import { devicePreferencesSchema, ingestedCaptureSchema } from '../../storage/local-models'
import { canonicalJson, entryFromCapture } from '../../storage/capture'
import { connectionSchema, syncJobSchema, leaseSchema, decisionSchema } from '../../storage/sync-models'
import type { CaptureIngestionResult } from '../capture/contracts'
import type { DuplicateChoice, ImportPreview } from '../import-export/contracts'
import { findPossibleDuplicates, normalizeForDuplicate, queryVocabulary, type VocabularyQuery } from './query'

export type VocabularyInput = VocabularyPayload & { origin?: CaptureOrigin; status?: VocabularyEntry['status'] }
export type SettingsPatch = Partial<Pick<AppSettings, 'theme' | 'dailyNew' | 'reviewEnabled' | 'desiredRetention'>>
export interface VocabularyStats { en: number; de: number; inbox: number; recent: VocabularyEntry[]; pendingCount: number }
export interface ImportCommitResult { added: number; updated: number; skipped: number }
export type LocalVocabularyErrorCode = 'duplicate' | 'not-found' | 'deleted' | 'stale-revision' | 'identity-change' | 'invalid-data' | 'incompatible-schema' | 'immutable-id' | 'storage'

export class LocalVocabularyError extends Error {
  readonly code: LocalVocabularyErrorCode
  readonly duplicates: VocabularyEntry[]
  constructor(code: LocalVocabularyErrorCode, message: string, duplicates: VocabularyEntry[] = []) {
    super(message)
    this.name = 'LocalVocabularyError'
    this.code = code
    this.duplicates = duplicates
  }
}

const statusSchema = z.enum(['inbox', 'learning', 'paused', 'archived'])
const inputMetadataSchema = z.strictObject({ origin: originSchema.optional(), status: statusSchema.optional() })
const metadataKeys = new Set(['id', 'schemaVersion', 'revisionId', 'parentRevisionIds', 'createdAt', 'updatedAt', 'deletedAt', 'origin', 'status'])

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  if (value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion !== 1) {
    throw new LocalVocabularyError('incompatible-schema', '数据版本不兼容，请先升级应用或保存原始备份。')
  }
  const result = schema.safeParse(value)
  if (!result.success) throw new LocalVocabularyError('invalid-data', '数据未通过校验，请检查字段、日期与版本。')
  return result.data
}

function parseInput(input: VocabularyInput): { payload: VocabularyPayload; origin?: CaptureOrigin; status?: VocabularyEntry['status'] } {
  const { origin, status, ...payload } = input
  return { payload: parse(vocabularyPayloadSchema, payload), ...parse(inputMetadataSchema, { origin, status }) }
}

function entryPayload(entry: VocabularyEntry): VocabularyPayload {
  return parse(vocabularyPayloadSchema, Object.fromEntries(Object.entries(entry).filter(([key]) => !metadataKeys.has(key))))
}

/** Only absent fields are supplemented. Nonempty arrays and scalar values are never overwritten. */
function fillEmptyFields(existing: VocabularyPayload, incoming: VocabularyPayload): VocabularyPayload {
  function meaningful(value: unknown): boolean {
    return value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0) && !(typeof value === 'string' && value.trim() === '')
  }
  function merge(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
    const result = { ...left }
    for (const [key, value] of Object.entries(right)) {
      if (!meaningful(value)) continue
      if (!meaningful(result[key])) result[key] = value
      else if (value && result[key] && typeof value === 'object' && typeof result[key] === 'object' && !Array.isArray(value) && !Array.isArray(result[key])) {
        result[key] = merge(result[key] as Record<string, unknown>, value as Record<string, unknown>)
      }
    }
    return result
  }
  const result = merge(existing, incoming)
  // A flat CSV row has no sense identity/provenance and cannot supplement senses.
  if (existing.lexicon) { result.lexicon = existing.lexicon; result.meanings = existing.meanings; result.partOfSpeech = existing.partOfSpeech }
  return parse(vocabularyPayloadSchema, result)
}

/** All business writes and their outbox records share a single IndexedDB transaction. */
export class LocalVocabularyService {
  readonly db: PolarDatabase
  private initializing?: Promise<void>
  private initialized = false

  constructor(db = new PolarDatabase()) { this.db = db }

  /** Revalidate after restore/reset; controlled reset may call this inside its own transaction. */
  invalidateInitialization(): void { this.initialized = false; this.initializing = undefined }

  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.initializing) return this.initializing
    this.initializing = this.db.transaction('rw', this.db.tables, async () => {
      await this.validateStoredRecords()
      const settings = await this.db.settings.toArray()
      const metadata = await this.db.syncMetadata.toArray()
      if (settings.length > 1 || metadata.length > 1) throw new LocalVocabularyError('invalid-data', '本机配置存在多个实例，请先导出并检查数据。')
      const now = new Date().toISOString()
      const deviceId = metadata[0]?.deviceId ?? crypto.randomUUID()
      if (metadata.length === 0) {
        await this.db.syncMetadata.add(parse(syncMetadataSchema, {
          id: crypto.randomUUID(), schemaVersion: 1, deviceId, status: 'unconfigured',
          baseSnapshotId: null, remoteSha: null, lastSyncedAt: null, updatedAt: now,
        }))
      }
      if (settings.length === 0) {
        const settingsRecord = parse(appSettingsSchema, {
          id: crypto.randomUUID(), schemaVersion: 1, revisionId: crypto.randomUUID(), parentRevisionIds: [], createdAt: now, updatedAt: now,
          theme: 'system', dailyNew: { en: 10, de: 5 }, reviewEnabled: { en: true, de: true }, desiredRetention: 0.9,
        })
        await this.db.settings.add(settingsRecord)
        await this.enqueue('update-settings', settingsRecord)
      }
      const preferences = await this.db.devicePreferences.where('deviceId').equals(deviceId).first()
      if (!preferences) await this.db.devicePreferences.add(parse(devicePreferencesSchema, { id: deviceId, deviceId, schemaVersion: 1, defaultLanguage: 'en', updatedAt: now }))
      await this.readSnapshot()
    })
    try { await this.initializing; this.initialized = true } finally { this.initializing = undefined }
  }

  private async validateStoredRecords(): Promise<void> {
    const schemas: Record<string, z.ZodType> = {
      vocabularies: vocabularyEntrySchema, cards: flashcardSchema, reviewEvents: reviewEventSchema,
      captures: captureEventSchema, tombstones: tombstoneSchema, reviewResolutions: reviewResolutionSchema,
      settings: appSettingsSchema, syncMetadata: syncMetadataSchema, pendingOperations: pendingOperationSchema,
      conflicts: syncConflictSchema, devicePreferences: devicePreferencesSchema, ingestedCaptures: ingestedCaptureSchema,
      connections: connectionSchema, syncJobs: syncJobSchema, syncLeases: leaseSchema, conflictDecisions: decisionSchema,
    }
    for (const table of this.db.tables) {
      const rows: unknown[] = await table.toArray()
      for (const row of rows) {
        if (table.name === 'syncBases') {
          const base = parse(z.strictObject({ id: uuidSchema, schemaVersion: z.literal(1), remoteSha: z.string().regex(/^[0-9a-f]{40}$/i), snapshot: dataSnapshotSchema }), row)
          parse(dataSnapshotSchema, base.snapshot)
        } else parse(schemas[table.name], row)
      }
    }
  }

  private async metadata(): Promise<SyncMetadata> {
    const record = await this.db.syncMetadata.toCollection().first()
    return parse(syncMetadataSchema, record)
  }

  private async enqueue(kind: PendingOperation['kind'], payload: PendingOperation['payload']): Promise<void> {
    const metadata = await this.metadata()
    const now = new Date().toISOString()
    const operation = parse(pendingOperationSchema, { id: crypto.randomUUID(), schemaVersion: 1, deviceId: metadata.deviceId, createdAt: now, baseSnapshotId: metadata.baseSnapshotId, kind, payload })
    await this.db.pendingOperations.add(operation)
    // No configured remote exists in Phase 1; pending count is shown independently.
    await this.db.syncMetadata.put(parse(syncMetadataSchema, { ...metadata, status: metadata.status === 'unconfigured' ? 'unconfigured' : 'pending', updatedAt: now }))
  }

  private async write<T>(work: () => Promise<T>): Promise<T> {
    await this.initialize()
    return this.db.transaction('rw', this.db.tables, async () => {
      await this.validateStoredRecords()
      await this.readSnapshot()
      const result = await work()
      await this.readSnapshot()
      return result
    })
  }

  /** Shared service-only transaction boundary; callers must not perform network work here. */
  async transaction<T>(work: () => Promise<T>): Promise<T> { return this.write(work) }

  /** Append an outbox operation inside the caller's business transaction. */
  async appendPending(kind: PendingOperation['kind'], payload: PendingOperation['payload']): Promise<void> {
    const transaction = this.db.constructor as typeof import('dexie').default
    if (transaction.currentTransaction?.db !== this.db || transaction.currentTransaction.mode !== 'readwrite') {
      throw new LocalVocabularyError('storage', '待同步操作必须和业务修改在同一写事务内保存。')
    }
    await this.enqueue(kind, payload)
  }

  private async activeEntry(id: UUID): Promise<VocabularyEntry> {
    parse(uuidSchema, id)
    const value = await this.db.vocabularies.get(id)
    if (!value) throw new LocalVocabularyError('not-found', '词条不存在。')
    const entry = parse(vocabularyEntrySchema, value)
    if (entry.deletedAt || await this.db.tombstones.where('[entityType+entityId]').equals(['vocabulary', id]).count()) throw new LocalVocabularyError('deleted', '词条已删除；恢复须创建新词条，不能复活旧记录。')
    return entry
  }

  private revisedEntry(existing: VocabularyEntry, payload: VocabularyPayload, status = existing.status): VocabularyEntry {
    if (existing.lexicon && !payload.lexicon) throw new LocalVocabularyError('invalid-data', '结构化义项不能通过旧编辑方式移除，请使用义项编辑器。')
    return parse(vocabularyEntrySchema, {
      ...payload, id: existing.id, schemaVersion: 1, revisionId: crypto.randomUUID(), parentRevisionIds: [existing.revisionId],
      origin: existing.origin, status, createdAt: existing.createdAt, updatedAt: new Date().toISOString(),
      ...(existing.deletedAt === null ? { deletedAt: null } : {}),
    })
  }

  async list(query: VocabularyQuery = {}): Promise<VocabularyEntry[]> {
    await this.initialize()
    return queryVocabulary((await this.db.vocabularies.toArray()).map((entry) => parse(vocabularyEntrySchema, entry)), query)
  }

  async get(id: UUID): Promise<VocabularyEntry | undefined> {
    await this.initialize()
    parse(uuidSchema, id)
    const value = await this.db.vocabularies.get(id)
    if (!value) return undefined
    const entry = parse(vocabularyEntrySchema, value)
    const hasTombstone = await this.db.tombstones.where('[entityType+entityId]').equals(['vocabulary', id]).count()
    return entry.deletedAt || hasTombstone ? undefined : entry
  }

  async findDuplicates(payload: VocabularyPayload): Promise<VocabularyEntry[]> {
    const validated = parse(vocabularyPayloadSchema, payload)
    return findPossibleDuplicates(await this.list(), validated)
  }

  async add(input: VocabularyInput, options: { allowDuplicate?: boolean; createdAt?: string } = {}): Promise<VocabularyEntry> {
    const parsed = parseInput(input)
    const createdAt = options.createdAt ? parse(utcDateTimeSchema, options.createdAt) : new Date().toISOString()
    return this.write(async () => {
      const duplicates = findPossibleDuplicates((await this.db.vocabularies.toArray()).map((value) => parse(vocabularyEntrySchema, value)), parsed.payload)
      if (duplicates.length && !options.allowDuplicate) throw new LocalVocabularyError('duplicate', '发现可能重复的词条，请确认后再新增。', duplicates)
      const entry = parse(vocabularyEntrySchema, { ...parsed.payload, id: crypto.randomUUID(), schemaVersion: 1, revisionId: crypto.randomUUID(), parentRevisionIds: [], origin: parsed.origin ?? 'manual', status: parsed.status ?? 'inbox', createdAt, updatedAt: createdAt })
      await this.db.vocabularies.add(entry)
      await this.enqueue('upsert-vocabulary', entry)
      return entry
    })
  }

  async update(id: UUID, input: VocabularyInput, options: { expectedRevisionId: UUID }): Promise<VocabularyEntry> {
    const parsed = parseInput(input)
    parse(uuidSchema, options.expectedRevisionId)
    return this.write(async () => {
      const existing = await this.activeEntry(id)
      if (existing.revisionId !== options.expectedRevisionId) throw new LocalVocabularyError('stale-revision', '词条已被另一页面修改，请重新打开后再编辑。')
      if (parsed.payload.lang !== existing.lang || (parsed.origin && parsed.origin !== existing.origin)) throw new LocalVocabularyError('identity-change', '语言和录入来源属于记录身份，不能通过编辑修改。')
      const next = this.revisedEntry(existing, parsed.payload, parsed.status ?? existing.status)
      await this.db.vocabularies.put(next)
      await this.enqueue('upsert-vocabulary', next)
      return next
    })
  }

  async batchUpdate(ids: readonly UUID[], patch: { status?: VocabularyEntry['status']; addTags?: readonly string[] }): Promise<void> {
    if (patch.status !== undefined) parse(statusSchema, patch.status)
    if (patch.addTags !== undefined) parse(z.array(z.string().min(1).max(80)).max(100), patch.addTags)
    await this.write(async () => {
      for (const id of new Set(ids)) {
        const existing = await this.activeEntry(id)
        const payload = entryPayload(existing)
        if (patch.addTags) payload.tags = [...new Set([...(payload.tags ?? []), ...patch.addTags])]
        const next = this.revisedEntry(existing, payload, patch.status ?? existing.status)
        await this.db.vocabularies.put(next)
        await this.enqueue('upsert-vocabulary', next)
      }
    })
  }

  async softDelete(ids: readonly UUID[]): Promise<void> {
    await this.write(async () => {
      const metadata = await this.metadata()
      const now = new Date().toISOString()
      for (const id of new Set(ids)) {
        parse(uuidSchema, id)
        const stored = await this.db.vocabularies.get(id)
        if (!stored) throw new LocalVocabularyError('not-found', '词条不存在。')
        const existing = parse(vocabularyEntrySchema, stored)
        if (existing.deletedAt) continue
        const deleted = parse(vocabularyEntrySchema, { ...existing, deletedAt: now, updatedAt: now, revisionId: crypto.randomUUID(), parentRevisionIds: [existing.revisionId] })
        await this.db.vocabularies.put(deleted)
        await this.enqueue('upsert-vocabulary', deleted)
        const tombstone = parse(tombstoneSchema, { id: crypto.randomUUID(), schemaVersion: 1, revisionId: crypto.randomUUID(), parentRevisionIds: [existing.revisionId], createdAt: now, updatedAt: now, deletedAt: now, deviceId: metadata.deviceId, entityType: 'vocabulary', entityId: id })
        await this.db.tombstones.add(tombstone)
        await this.enqueue('delete-record', tombstone)
        for (const rawCard of await this.db.cards.where('vocabularyId').equals(id).toArray()) {
          const card = parse(flashcardSchema, rawCard)
          if (card.deletedAt) continue
          const deletedCard = parse(flashcardSchema, { ...card, suspended: true, deletedAt: now, updatedAt: now, revisionId: crypto.randomUUID(), parentRevisionIds: [card.revisionId] })
          await this.db.cards.put(deletedCard)
          await this.enqueue('upsert-card', deletedCard)
          const cardTombstone = parse(tombstoneSchema, { ...tombstone, id: crypto.randomUUID(), revisionId: crypto.randomUUID(), parentRevisionIds: [card.revisionId], entityType: 'card', entityId: card.id })
          await this.db.tombstones.add(cardTombstone)
          await this.enqueue('delete-record', cardTombstone)
        }
      }
    })
  }

  async getSettings(): Promise<AppSettings> {
    await this.initialize()
    return parse(appSettingsSchema, await this.db.settings.toCollection().first())
  }

  async updateSettings(patch: SettingsPatch): Promise<AppSettings> {
    if (patch.desiredRetention !== undefined && (patch.desiredRetention < 0.7 || patch.desiredRetention > 0.99)) {
      throw new LocalVocabularyError('invalid-data', '目标保持率请设置在 0.70–0.99 之间。')
    }
    return this.write(async () => {
      const current = parse(appSettingsSchema, await this.db.settings.toCollection().first())
      const allowedKeys = ['theme', 'dailyNew', 'reviewEnabled', 'desiredRetention']
      if (Object.keys(patch).some((key) => !allowedKeys.includes(key))) throw new LocalVocabularyError('invalid-data', '设置包含不支持的字段。')
      const settings = parse(appSettingsSchema, { ...current, ...patch, revisionId: crypto.randomUUID(), parentRevisionIds: [current.revisionId], updatedAt: new Date().toISOString() })
      await this.db.settings.put(settings)
      await this.enqueue('update-settings', settings)
      return settings
    })
  }

  async getDeviceId(): Promise<UUID> { await this.initialize(); return (await this.metadata()).deviceId }

  async getDefaultLanguage(): Promise<Language> {
    await this.initialize()
    const deviceId = (await this.metadata()).deviceId
    return parse(devicePreferencesSchema, await this.db.devicePreferences.where('deviceId').equals(deviceId).first()).defaultLanguage
  }

  async setDefaultLanguage(language: Language): Promise<void> {
    parse(languageSchema, language)
    await this.write(async () => {
      const deviceId = (await this.metadata()).deviceId
      const current = parse(devicePreferencesSchema, await this.db.devicePreferences.where('deviceId').equals(deviceId).first())
      await this.db.devicePreferences.put(parse(devicePreferencesSchema, { ...current, defaultLanguage: language, updatedAt: new Date().toISOString() }))
    })
  }

  async stats(): Promise<VocabularyStats> {
    const entries = await this.list()
    return { en: entries.filter((entry) => entry.lang === 'en').length, de: entries.filter((entry) => entry.lang === 'de').length, inbox: entries.filter((entry) => entry.status === 'inbox').length, recent: entries.slice(0, 5), pendingCount: await this.db.pendingOperations.count() }
  }

  async snapshot(): Promise<DataSnapshot> {
    await this.initialize()
    return this.db.transaction('r', this.db.tables, async () => {
      await this.validateStoredRecords()
      return this.readSnapshot()
    })
  }

  private async readSnapshot(): Promise<DataSnapshot> {
    return parse(dataSnapshotSchema, {
      id: crypto.randomUUID(), schemaVersion: 1, exportedAt: new Date().toISOString(),
      vocabularies: await this.db.vocabularies.toArray(), cards: await this.db.cards.toArray(), reviewEvents: await this.db.reviewEvents.toArray(),
      captures: await this.db.captures.toArray(), tombstones: await this.db.tombstones.toArray(), reviewResolutions: await this.db.reviewResolutions.toArray(),
      ingestedCaptureIds: (await this.db.ingestedCaptures.toArray()).map((record) => record.id), settings: await this.db.settings.toCollection().first(),
    })
  }

  private async retainCapture(event: CaptureEvent): Promise<boolean> {
    const previous = await this.db.captures.get(event.id)
    if (previous && canonicalJson(parse(captureEventSchema, previous)) !== canonicalJson(event)) throw new LocalVocabularyError('immutable-id', '相同捕获 ID 的内容不一致，未写入任何词条。')
    const receipt = await this.db.ingestedCaptures.get(event.id)
    if (receipt) {
      parse(ingestedCaptureSchema, receipt)
      if (!previous) throw new LocalVocabularyError('invalid-data', '摄取记录缺少原始捕获事件。')
      return false
    }
    if (!previous) { await this.db.captures.add(event); await this.enqueue('append-capture', event) }
    return true
  }

  async ingest(events: readonly CaptureEvent[]): Promise<CaptureIngestionResult> {
    let currentCaptureId: UUID | undefined
    try {
      const validated = events.map((event) => parse(captureEventSchema, event))
      return await this.write(async () => {
        const vocabularyIds: UUID[] = []
        const skippedCaptureIds: UUID[] = []
        for (const event of validated) {
          currentCaptureId = event.id
          if (!await this.retainCapture(event)) { skippedCaptureIds.push(event.id); continue }
          const entry = entryFromCapture(event)
          const previous = await this.db.vocabularies.get(entry.id)
          if (previous && canonicalJson(previous) !== canonicalJson(entry)) throw new LocalVocabularyError('immutable-id', '确定性词条 ID 已对应不同内容。')
          if (!previous) { await this.db.vocabularies.add(entry); await this.enqueue('upsert-vocabulary', entry) }
          await this.db.ingestedCaptures.add(parse(ingestedCaptureSchema, { id: event.id, schemaVersion: 1 }))
          vocabularyIds.push(entry.id)
        }
        return { status: 'saved', vocabularyIds, skippedCaptureIds }
      })
    } catch (error) {
      if (error instanceof LocalVocabularyError && error.code === 'immutable-id' && currentCaptureId) return { status: 'conflict', captureId: currentCaptureId, reason: 'immutable-id' }
      if (error instanceof LocalVocabularyError && error.code === 'incompatible-schema') return { status: 'failed', reason: 'incompatible-schema' }
      if (error instanceof LocalVocabularyError && error.code === 'invalid-data') return { status: 'failed', reason: 'invalid-data' }
      return { status: 'failed', reason: 'storage' }
    }
  }

  async commitImport(preview: ImportPreview, choices: Readonly<Record<UUID, DuplicateChoice>>): Promise<ImportCommitResult> {
    parse(uuidSchema, preview.batchId)
    if (preview.mode !== 'merge-vocabulary') throw new LocalVocabularyError('invalid-data', '导入模式不兼容。')
    const rows = preview.rows.map((row) => ({ ...row, rowId: parse(uuidSchema, row.rowId), payload: parse(vocabularyPayloadSchema, row.payload), capturedAt: parse(utcDateTimeSchema, row.capturedAt), ...(row.createdAt ? { createdAt: parse(utcDateTimeSchema, row.createdAt) } : {}) }))
    return this.write(async () => {
      const result: ImportCommitResult = { added: 0, updated: 0, skipped: 0 }
      const deviceId = (await this.metadata()).deviceId
      // This transaction owns the write lock. Keep its duplicate index current after each row
      // instead of re-reading and re-validating the whole table for a 5,000-row import.
      const duplicateIndex = new Map<string, VocabularyEntry[]>()
      const duplicateKey = (payload: VocabularyPayload) => `${payload.lang}:${normalizeForDuplicate(payload.lemma, payload.lang)}`
      const registerEntry = (entry: VocabularyEntry) => {
        const key = duplicateKey(entry)
        const candidates = duplicateIndex.get(key) ?? []
        const index = candidates.findIndex((candidate) => candidate.id === entry.id)
        if (index < 0) candidates.push(entry)
        else candidates[index] = entry
        duplicateIndex.set(key, candidates)
      }
      for (const rawEntry of await this.db.vocabularies.toArray()) {
        const entry = parse(vocabularyEntrySchema, rawEntry)
        if (!entry.deletedAt) registerEntry(entry)
      }
      for (const row of rows) {
        const choice = choices[row.rowId] ?? 'skip'
        if (!['skip', 'fill-empty-fields', 'keep-separate'].includes(choice)) throw new LocalVocabularyError('invalid-data', '重复词处理选项不兼容。')
        const event = parse(captureEventSchema, { id: row.rowId, schemaVersion: 1, deviceId, capturedAt: row.createdAt ?? row.capturedAt, origin: row.origin, payload: row.payload })
        if (!await this.retainCapture(event)) { result.skipped += 1; continue }
        const duplicates = duplicateIndex.get(duplicateKey(row.payload)) ?? []
        if (duplicates.length && choice === 'skip') result.skipped += 1
        else if (duplicates.length && choice === 'fill-empty-fields') {
          if (duplicates.length !== 1) throw new LocalVocabularyError('duplicate', '存在多个相似词条，请查看后选择跳过或独立新增。', duplicates)
          const existing = await this.activeEntry(duplicates[0].id)
          const supplemented = fillEmptyFields(entryPayload(existing), row.payload)
          if (canonicalJson(entryPayload(existing)) !== canonicalJson(supplemented)) {
            const next = this.revisedEntry(existing, supplemented)
            await this.db.vocabularies.put(next)
            await this.enqueue('upsert-vocabulary', next)
            registerEntry(next)
            result.updated += 1
          } else result.skipped += 1
        } else {
          const entry = entryFromCapture(event)
          if (await this.db.vocabularies.get(entry.id)) throw new LocalVocabularyError('immutable-id', '导入行已对应另一词条，未覆盖原数据。')
          await this.db.vocabularies.add(entry)
          await this.enqueue('upsert-vocabulary', entry)
          registerEntry(entry)
          result.added += 1
        }
        await this.db.ingestedCaptures.add(parse(ingestedCaptureSchema, { id: row.rowId, schemaVersion: 1 }))
      }
      return result
    })
  }
}

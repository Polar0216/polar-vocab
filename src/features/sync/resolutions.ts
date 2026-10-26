import { senseMeanings } from '../../../packages/shared/lexicon'
import type { Lexicon } from '../../domain/lexicon'
import { flashcardSchema, reviewResolutionSchema, tombstoneSchema, vocabularyEntrySchema, appSettingsSchema, type SyncConflict } from '../../domain'
import type { LocalVocabularyService } from '../vocabulary/service'
import { canonicalJson } from '../../storage/capture'
import { SyncError } from './engine'

/** A decision is an audited local operation; subsequent synchronization still checks current SHA. */
export async function resolveConflict(service: LocalVocabularyService, id: string, choice: 'local' | 'remote' | 'keep-deleted' | 'review' | 'card', selectedId?: string): Promise<void> {
  const { validateLearningSnapshot } = await import('../review/integrity')
  await service.transaction(async () => {
    const db = service.db; const conflict = await db.conflicts.get(id)
    if (!conflict) throw new SyncError('冲突已经变化，请刷新列表。')
    if (conflict.kind === 'immutable-id' || conflict.fields.includes('missing-record')) throw new SyncError('身份或不可变记录损坏不能选择覆盖。请导出备份并核查远端历史。')
    const snapshot = await service.snapshot(); const now = new Date().toISOString()
    if (choice === 'review') {
      const card = snapshot.cards.find((record) => record.id === conflict.entityId)
      const selected = snapshot.reviewEvents.find((event) => event.id === selectedId && event.cardId === card?.id)
      if (!card || !selected) throw new SyncError('请选择此卡片的有效评分分支。')
      const siblings = snapshot.reviewEvents.filter((event) => event.cardId === card.id && event.parentStateId === selected.parentStateId)
      if (siblings.length < 2) throw new SyncError('没有可决议的同父分支。')
      let head = selected
      while (true) {
        const children = snapshot.reviewEvents.filter((event) => event.parentReviewEventId === head.id && !event.parentResolutionId)
        if (children.length > 1) throw new SyncError('选定分支还有内部分叉，请先解决更深层分叉。')
        if (!children.length) break
        head = children[0]
      }
      const ignoredIds = new Set(siblings.filter((event) => event.id !== selected.id).map((event) => event.id))
      let grew = true
      while (grew) { grew = false; for (const event of snapshot.reviewEvents) if (event.parentReviewEventId && ignoredIds.has(event.parentReviewEventId) && !ignoredIds.has(event.id)) { ignoredIds.add(event.id); grew = true } }
      const resolution = reviewResolutionSchema.parse({ id: crypto.randomUUID(), schemaVersion: 1, conflictId: id, cardId: card.id, deviceId: await service.getDeviceId(), createdAt: now, parentStateId: selected.parentStateId, selectedEventId: selected.id, selectedHeadEventId: head.id, ignoredEventIds: [...ignoredIds], resultingStateId: crypto.randomUUID(), resolvedState: head.afterState })
      const candidates = [conflict.local, conflict.remote].filter((record) => record && 'revisionId' in record).map((record) => String((record as { revisionId: string }).revisionId))
      const next = flashcardSchema.parse({ ...card, stateId: resolution.resultingStateId, fsrsState: head.afterState, lastReviewEventId: head.id, settingsVersion: head.settingsVersion, schedulerVersion: head.schedulerVersion, revisionId: crypto.randomUUID(), parentRevisionIds: [...new Set([card.revisionId, ...candidates])], updatedAt: now })
      await db.reviewResolutions.add(resolution); await db.cards.put(next)
      await service.appendPending('resolve-review', resolution); await service.appendPending('upsert-card', next)
    } else if (choice === 'card') {
      const candidates = snapshot.cards.filter((card) => !card.deletedAt && card.vocabularyId === (conflict.local && 'vocabularyId' in conflict.local ? conflict.local.vocabularyId : '') && card.template === (conflict.local && 'template' in conflict.local ? conflict.local.template : ''))
      if (!candidates.some((card) => card.id === selectedId)) throw new SyncError('请选择保留的卡片。')
      for (const card of candidates.filter((card) => card.id !== selectedId)) {
        const next = flashcardSchema.parse({ ...card, suspended: true, deletedAt: now, updatedAt: now, revisionId: crypto.randomUUID(), parentRevisionIds: [card.revisionId] })
        const tombstone = tombstoneSchema.parse({ id: crypto.randomUUID(), schemaVersion: 1, revisionId: crypto.randomUUID(), parentRevisionIds: [card.revisionId], createdAt: now, updatedAt: now, deletedAt: now, entityType: 'card', entityId: card.id, deviceId: await service.getDeviceId() })
        await db.cards.put(next); await db.tombstones.add(tombstone); await service.appendPending('upsert-card', next); await service.appendPending('delete-record', tombstone)
      }
    } else {
      const table = conflict.entityType === 'vocabulary' ? db.vocabularies : conflict.entityType === 'settings' ? db.settings : db.cards
      const current = await table.get(conflict.entityId)
      const candidate = choice === 'keep-deleted' ? current : choice === 'local' ? conflict.local : conflict.remote
      if (!current || !candidate || !('revisionId' in candidate)) throw new SyncError('此冲突不能按所选方式处理。')
      if (conflict.kind === 'delete-vs-edit' && choice !== 'keep-deleted') throw new SyncError('旧 UUID 已删除，只能保留删除；编辑副本可备份后另建新词条。')
      if (conflict.local && 'revisionId' in conflict.local && current.revisionId !== conflict.local.revisionId && canonicalJson(current) !== canonicalJson(conflict.remote) && conflict.kind !== 'delete-vs-edit') throw new SyncError('冲突产生后本机记录已编辑，请先重新同步，避免丢失新修改。')
      const parents = [current.revisionId, ...[conflict.local, conflict.remote].flatMap((record) => record && 'revisionId' in record ? [record.revisionId] : [])]
      const chosen: Record<string, unknown> = structuredClone(current)
      if (conflict.kind === 'field' && !conflict.fields.includes('new-record')) {
        // Change only contested paths; independent fields were already safely merged.
        for (const path of conflict.fields) {
          const keys = path.split('.'); let source = candidate as Record<string, unknown>; let destination = chosen
          for (const key of keys.slice(0, -1)) { source = (source?.[key] ?? {}) as Record<string, unknown>; destination[key] = { ...(destination[key] as object ?? {}) }; destination = destination[key] as Record<string, unknown> }
          const key = keys.at(-1)!; if (source[key] === undefined) delete destination[key]; else destination[key] = source[key]
        }
      } else Object.assign(chosen, candidate)
      if (conflict.entityType === 'vocabulary' && chosen.lexicon) { chosen.meanings = senseMeanings(chosen.lexicon as Lexicon); delete chosen.partOfSpeech }
      const next = { ...chosen, revisionId: crypto.randomUUID(), parentRevisionIds: [...new Set(parents)], updatedAt: now }
      if (conflict.entityType === 'vocabulary') { const parsed = vocabularyEntrySchema.parse(next); await db.vocabularies.put(parsed); await service.appendPending('upsert-vocabulary', parsed) }
      else if (conflict.entityType === 'settings') { const parsed = appSettingsSchema.parse(next); await db.settings.put(parsed); await service.appendPending('update-settings', parsed) }
      else { const parsed = flashcardSchema.parse(next); await db.cards.put(parsed); await service.appendPending('upsert-card', parsed) }
    }
    await db.conflictDecisions.add({ id: crypto.randomUUID(), schemaVersion: 1, conflict: conflict as SyncConflict, choice, createdAt: now })
    await db.conflicts.delete(id)
    // A new decision changes the frozen input. Unacknowledged operations remain in outbox.
    await db.syncJobs.clear()
    validateLearningSnapshot(await service.snapshot(), true)
  })
}

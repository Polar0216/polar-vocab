import { v5 } from 'uuid'
import { senseMeanings } from '../../../packages/shared/lexicon'
import type { Lexicon } from '../../domain/lexicon'
import { dataSnapshotSchema, syncConflictSchema, type DataSnapshot, type SyncConflict } from '../../domain'
import { canonicalJson, CAPTURE_NAMESPACE } from '../../storage/capture'
import { logical } from './protocol'

type RecordValue = Record<string, unknown> & { id: string }
const equal = (a: unknown, b: unknown) => a === undefined || b === undefined ? a === b : canonicalJson(a) === canonicalJson(b)
const mutableMeta = new Set(['revisionId', 'parentRevisionIds', 'updatedAt'])
function body(record: RecordValue): Record<string, unknown> { return Object.fromEntries(Object.entries(record).filter(([key]) => !mutableMeta.has(key))) }
function revision(record: RecordValue): string { return String(record.revisionId) }
function ancestors(record: RecordValue): string[] { return record.parentRevisionIds as string[] }
function mergedRevision(record: RecordValue, a: RecordValue, b: RecordValue): RecordValue {
  if (equal(body(record), body(a))) return a
  if (equal(body(record), body(b))) return b
  const parents = [...new Set([revision(a), revision(b), ...ancestors(a), ...ancestors(b)])].sort()
  return { ...record, revisionId: v5(canonicalJson({ body: body(record), parents }), CAPTURE_NAMESPACE), parentRevisionIds: parents, updatedAt: [String(a.updatedAt), String(b.updatedAt)].sort().at(-1) }
}
export interface MergeResult { snapshot: DataSnapshot; conflicts: SyncConflict[] }

/** UUID union, common-base fields, atomic state groups and append-only evidence. */
export function mergeSnapshots(base: DataSnapshot | null, local: DataSnapshot, remote: DataSnapshot): MergeResult {
  const conflicts: SyncConflict[] = []
  const result = structuredClone(local)
  const conflict = (entityType: SyncConflict['entityType'], id: string, kind: SyncConflict['kind'], fields: string[], b: unknown, l: unknown, r: unknown) => {
    const record = syncConflictSchema.parse({ id: v5(canonicalJson({ entityType, id, kind, fields, b, l, r }), CAPTURE_NAMESPACE), schemaVersion: 1, createdAt: new Date().toISOString(), entityType, entityId: id, kind, fields, base: b ?? null, local: l ?? null, remote: r ?? null })
    conflicts.push(record)
  }
  const immutable = (name: 'reviewEvents' | 'captures' | 'reviewResolutions' | 'tombstones', entity: SyncConflict['entityType']) => {
    const map = new Map(local[name].map((item) => [item.id, item]))
    for (const item of remote[name]) {
      const existing = map.get(item.id)
      if (existing && !equal(existing, item)) conflict(entity, item.id, 'immutable-id', [], undefined, existing, item)
      else map.set(item.id, item)
    }
    // Removing immutable history in a hand-edited remote file is never accepted.
    for (const item of base?.[name] ?? []) if (!remote[name].some((record) => record.id === item.id)) conflict(entity, item.id, 'immutable-id', ['missing-remote'], item, map.get(item.id), undefined)
    return [...map.values()]
  }
  result.reviewEvents = immutable('reviewEvents', 'review-event') as DataSnapshot['reviewEvents']
  result.captures = immutable('captures', 'capture') as DataSnapshot['captures']
  result.reviewResolutions = immutable('reviewResolutions', 'review-resolution') as DataSnapshot['reviewResolutions']
  result.tombstones = immutable('tombstones', 'tombstone') as DataSnapshot['tombstones']
  result.ingestedCaptureIds = [...new Set([...local.ingestedCaptureIds, ...remote.ingestedCaptureIds])]
  const stateParents = new Map(result.reviewEvents.map((event) => [event.resultingStateId, event.parentStateId]))
  for (const resolution of result.reviewResolutions) stateParents.set(resolution.resultingStateId, result.reviewEvents.find((event) => event.id === (resolution.selectedHeadEventId ?? resolution.selectedEventId))!.resultingStateId)
  function stateDescends(child: string, parent: string): boolean {
    const seen = new Set<string>()
    while (child !== parent && !seen.has(child)) { seen.add(child); const next = stateParents.get(child); if (!next) return false; child = next }
    return child === parent
  }
  const scheduleKeys = ['fsrsState', 'stateId', 'lastReviewEventId', 'schedulerVersion', 'settingsVersion']
  function mergeRecord(entity: 'vocabulary' | 'card' | 'settings', b: RecordValue | undefined, l: RecordValue | undefined, r: RecordValue | undefined): RecordValue {
    const id = (l ?? r ?? b)!.id
    if (!l || !r) {
      const survivor = (l ?? r ?? b)!
      if (b) conflict(entity, id, 'field', ['missing-record'], b, l, r)
      return survivor
    }
    if (equal(l, r)) return l
    const identity = ['id', 'schemaVersion', 'createdAt', ...(entity === 'vocabulary' ? ['lang', 'origin'] : entity === 'card' ? ['vocabularyId', 'template'] : [])]
    if (identity.some((key) => !equal(l[key], r[key]) || b && !equal(b[key], l[key]))) { conflict(entity, id, 'immutable-id', identity, b, l, r); return l }
    const deleted = entity !== 'settings' && result.tombstones.some((item) => item.entityType === entity && item.entityId === id)
    if (deleted) {
      if (l.deletedAt && r.deletedAt) {
        // A keep-deleted decision is a descendant of both conflicting revisions.
        // Prefer that proof before selecting a deleted copy, or peers re-upload
        // their own older deletion forever despite agreeing on visible content.
        if (ancestors(l).includes(revision(r))) return l
        if (ancestors(r).includes(revision(l))) return r
        if (b && equal(l, b)) return r
        if (b && equal(r, b)) return l
        const held = revision(l) < revision(r) ? l : r
        if (!equal(body(l), body(r))) conflict(entity, id, 'delete-vs-edit', ['deletedAt'], b, l, r)
        return held
      }
      const dead = l.deletedAt ? l : r.deletedAt ? r : undefined
      if (!dead) { conflict(entity, id, 'delete-vs-edit', ['deletedAt'], b, l, r); return l }
      const live = l.deletedAt ? r : l
      if (!live.deletedAt && !ancestors(dead).includes(revision(live)) && (!b || !equal(body(live), body(b)))) conflict(entity, id, 'delete-vs-edit', ['deletedAt'], b, l, r)
      return dead
    }
    if (b && equal(l, b)) return r
    if (b && equal(r, b)) return l
    // Explicit resolutions name both candidate revisions; clocks do not choose winners.
    if (ancestors(l).includes(revision(r))) return l
    if (ancestors(r).includes(revision(l))) return r
    if (!b) { conflict(entity, id, 'field', ['new-record'], undefined, l, r); return l }
    const merged = { ...l }
    const fields: string[] = []
    function value(path: string, bv: unknown, lv: unknown, rv: unknown): unknown {
      if (equal(lv, rv) || equal(rv, bv)) return lv
      if (equal(lv, bv)) return rv
      fields.push(path); return lv
    }
    const lemmaKeys = ['lemma', 'encounteredForm', 'lemmaResolution']
    const structuredLemma = entity === 'vocabulary' && [b, l, r].some(record => record.encounteredForm !== undefined || record.lemmaResolution !== undefined)
    if (structuredLemma) {
      const group = (record: RecordValue) => Object.fromEntries(lemmaKeys.map(key => [key, record[key]]))
      const bg = group(b), lg = group(l), rg = group(r)
      let selected = l
      if (equal(lg, rg) || equal(bg, rg)) selected = l
      else if (equal(bg, lg)) selected = r
      else fields.push(...lemmaKeys)
      for (const key of lemmaKeys) { if (selected[key] === undefined) delete merged[key]; else merged[key] = selected[key] }
    }
    for (const key of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
      if (mutableMeta.has(key) || identity.includes(key) || entity === 'card' && scheduleKeys.includes(key)) continue
      if (structuredLemma && lemmaKeys.includes(key)) continue
      if (['en', 'de', 'dailyNew', 'reviewEnabled'].includes(key) && b[key] && l[key] && r[key]) {
        const bo = b[key] as Record<string, unknown>, lo = l[key] as Record<string, unknown>, ro = r[key] as Record<string, unknown>
        merged[key] = Object.fromEntries([...new Set([...Object.keys(bo), ...Object.keys(lo), ...Object.keys(ro)])].map((leaf) => [leaf, value(`${key}.${leaf}`, bo[leaf], lo[leaf], ro[leaf])]).filter(([, v]) => v !== undefined))
      } else if (key === 'contexts' && [b[key], l[key], r[key]].some(contexts => Array.isArray(contexts) && contexts.some(context => context.translation !== undefined || context.translationLanguage !== undefined || context.translationSource !== undefined))) {
        // Translation text/language/provenance belong together. Keep these contexts atomic;
        // the legacy per-context merge below must not drop the extension fields.
        const next = value(key, b[key], l[key], r[key]); if (next === undefined) delete merged[key]; else merged[key] = next
      } else if (key === 'contexts' && Array.isArray(b[key]) && Array.isArray(l[key]) && Array.isArray(r[key]) && (b[key] as {id: string}[]).every((item) => (l[key] as {id: string}[]).some((c) => c.id === item.id) && (r[key] as {id: string}[]).some((c) => c.id === item.id))) {
        const bm = new Map((b[key] as RecordValue[]).map((c) => [c.id, c])), lm = new Map((l[key] as RecordValue[]).map((c) => [c.id, c])), rm = new Map((r[key] as RecordValue[]).map((c) => [c.id, c]))
        merged[key] = [...new Set([...lm.keys(), ...rm.keys()])].sort().map((contextId) => {
          const bc = bm.get(contextId), lc = lm.get(contextId), rc = rm.get(contextId)
          if (!lc || !rc) return lc ?? rc
          return { id: contextId, text: value(`contexts.${contextId}.text`, bc?.text, lc.text, rc.text), source: value(`contexts.${contextId}.source`, bc?.source, lc.source, rc.source) }
        })
      } else { const next = value(key, b[key], l[key], r[key]); if (next === undefined) delete merged[key]; else merged[key] = next }
    }
    if (entity === 'vocabulary' && merged.lexicon) {
      // Structured senses are an atomic field; derive the review projection from the chosen field.
      merged.meanings = senseMeanings(merged.lexicon as Lexicon); delete merged.partOfSpeech
    }
    if (entity === 'card') {
      const group = (record: RecordValue) => Object.fromEntries(scheduleKeys.map((key) => [key, record[key]]))
      let state = l
      if (equal(group(l), group(r)) || equal(group(r), group(b))) state = l
      else if (equal(group(l), group(b))) state = r
      else if (stateDescends(String(l.stateId), String(r.stateId))) state = l
      else if (stateDescends(String(r.stateId), String(l.stateId))) state = r
      else fields.push('schedule')
      for (const key of scheduleKeys) { if (state[key] === undefined) delete merged[key]; else merged[key] = state[key] }
    }
    if (fields.length) { const held = mergedRevision(merged, l, l); conflict(entity, id, fields.includes('schedule') ? 'review-branch' : 'field', fields, b, held, r); return held }
    return mergedRevision(merged, l, r)
  }
  for (const [name, entity] of [['vocabularies', 'vocabulary'], ['cards', 'card']] as const) {
    const bm = new Map((base?.[name] ?? []).map((record) => [record.id, record as unknown as RecordValue]))
    const lm = new Map(local[name].map((record) => [record.id, record as unknown as RecordValue])), rm = new Map(remote[name].map((record) => [record.id, record as unknown as RecordValue]))
    result[name] = [...new Set([...bm.keys(), ...lm.keys(), ...rm.keys()])].map((id) => mergeRecord(entity, bm.get(id), lm.get(id), rm.get(id))) as never
  }
  // First connection adopts the remote singleton and preserves local preferences for preview/audit.
  result.settings = !base && local.settings.id !== remote.settings.id ? remote.settings : mergeRecord('settings', base?.settings as unknown as RecordValue, local.settings as unknown as RecordValue, remote.settings as unknown as RecordValue) as unknown as DataSnapshot['settings']
  const ignored = new Set(result.reviewResolutions.flatMap((r) => r.ignoredEventIds))
  const groups = new Map<string, DataSnapshot['reviewEvents']>()
  for (const event of result.reviewEvents) { if (ignored.has(event.id)) continue; const key = event.cardId + ':' + event.parentStateId; groups.set(key, [...(groups.get(key) ?? []), event]) }
  for (const events of groups.values()) if (events.length > 1 && !conflicts.some((c) => c.entityId === events[0].cardId && c.kind === 'review-branch')) conflict('card', events[0].cardId, 'review-branch', ['schedule'], undefined, local.cards.find((c) => c.id === events[0].cardId), remote.cards.find((c) => c.id === events[0].cardId))
  const templates = new Map<string, DataSnapshot['cards']>()
  for (const card of result.cards.filter((c) => !c.deletedAt)) { const key = card.vocabularyId + ':' + card.template; templates.set(key, [...(templates.get(key) ?? []), card]) }
  for (const cards of templates.values()) if (cards.length > 1) conflict('card', cards[0].id, 'field', ['duplicate-template'], undefined, cards[0], cards[1])
  result.id = v5(logical(result), CAPTURE_NAMESPACE)
  result.exportedAt = [...result.vocabularies.map((record) => record.updatedAt), local.exportedAt, remote.exportedAt].sort().at(-1)!
  // Undefined object fields are omitted before strict schema validation.
  return { snapshot: dataSnapshotSchema.parse(JSON.parse(canonicalJson(result))), conflicts }
}

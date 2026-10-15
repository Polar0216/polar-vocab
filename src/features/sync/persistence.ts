import type { DataSnapshot, SyncConflict } from '../../domain'
import type { PolarDatabase } from '../../storage/database'

/** Called only in the common local rw transaction. Never touches local device/auth tables. */
export async function writeWorking(db: PolarDatabase, snapshot: DataSnapshot): Promise<void> {
  for (const name of ['vocabularies', 'cards', 'reviewEvents', 'captures', 'tombstones', 'reviewResolutions'] as const) {
    await db.table(name).bulkPut(snapshot[name])
  }
  await db.settings.clear(); await db.settings.add(snapshot.settings)
  await db.ingestedCaptures.bulkPut(snapshot.ingestedCaptureIds.map((id) => ({ id, schemaVersion: 1 as const })))
}
export async function replaceConflicts(db: PolarDatabase, conflicts: SyncConflict[]): Promise<void> {
  const distinct = new Map<string, SyncConflict>()
  for (const conflict of conflicts) {
    const key = conflict.entityType + ':' + conflict.entityId + ':' + conflict.kind + ':' + [...conflict.fields].sort().join(',')
    if (!distinct.has(key)) distinct.set(key, conflict)
  }
  const next = [...distinct.values()], ids = new Set(next.map((record) => record.id))
  for (const old of await db.conflicts.toArray()) if (!ids.has(old.id)) await db.conflictDecisions.add({ id: crypto.randomUUID(), schemaVersion: 1, conflict: old, choice: 'refresh', createdAt: new Date().toISOString() })
  await db.conflicts.clear(); await db.conflicts.bulkPut(next)
}

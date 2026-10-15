import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { PolarDatabase } from '../../src/storage/database'

let database: PolarDatabase | undefined
afterEach(async () => { await database?.delete(); database = undefined })

describe('Dexie schema keeps Phase 0 tables and adds local Phase 1 records', () => {
  it('does not open until requested, opens all empty tables, and indexes scheduling and pending data', async () => {
    database = new PolarDatabase(`polar-vocab-test-${crypto.randomUUID()}`)
    expect(database.isOpen()).toBe(false)
    await database.open()
    expect(database.verno).toBe(3)
    expect(database.tables.map((table) => table.name).sort()).toEqual([
      'vocabularies', 'cards', 'reviewEvents', 'captures', 'tombstones', 'reviewResolutions',
      'connections', 'syncJobs', 'syncLeases', 'conflictDecisions', 'settings', 'syncMetadata', 'syncBases', 'pendingOperations', 'conflicts', 'devicePreferences', 'ingestedCaptures',
    ].sort())
    for (const table of database.tables) expect(await table.count()).toBe(0)
    expect(database.cards.schema.indexes.map((index) => index.name)).toContain('fsrsState.due')
    expect(database.reviewEvents.schema.indexes.map((index) => index.name)).toContain('[cardId+parentStateId]')
    expect(database.tombstones.schema.indexes.find((index) => index.name === '[entityType+entityId]')?.unique).toBe(false)
  })
})

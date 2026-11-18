import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { capturedTables } from '@/jobs/changes.registry'
import { dbChangeTriggersSql } from '../../scripts/dbChangeTriggers'
import { useTestService } from '@/test-service'

const service = useTestService()

type Trigger = { table: string; events: string[]; args: string[] }

// The triggers this database actually has. tgtype's bits are ROW(1),
// BEFORE(2), INSERT(4), DELETE(8), UPDATE(16), TRUNCATE(32) and INSTEAD(64);
// the arguments are the primary key columns triggerSql passes by name, which
// only the trigger's own definition text gives back readably (tgargs is
// bytea).
//
// One trigger per operation, so a table's arrive as several rows and are
// folded back into one entry: what the registry says is "this table, these
// operations", and how the generator splits them is its business.
const deployedTriggers = async (): Promise<Trigger[]> => {
  const rows = await service.prisma.$queryRaw<
    Array<{ table: string; tgtype: number; definition: string }>
  >`
    SELECT c.relname AS table, t.tgtype, pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND t.tgfoid = 'db_change_capture'::regproc
    ORDER BY c.relname, t.tgname
  `
  const byTable = new Map<string, Trigger>()
  for (const row of rows) {
    const found = byTable.get(row.table) ?? {
      table: row.table,
      events: [],
      args: [...row.definition.matchAll(/'([^']*)'/g)].map((m) => m[1]!),
    }
    for (const [bit, event] of [
      [4, 'insert'],
      [16, 'update'],
      [8, 'delete'],
    ] as const) {
      if (row.tgtype & bit && !found.events.includes(event)) {
        found.events.push(event)
      }
    }
    byTable.set(row.table, found)
  }
  return [...byTable.values()].map((trigger) => ({
    ...trigger,
    events: (['insert', 'update', 'delete'] as const).filter((op) =>
      trigger.events.includes(op),
    ),
  }))
}

const inRegistry = () =>
  capturedTables()
    .map(({ table, primaryKey, operations }) => ({
      table,
      events: (['insert', 'update', 'delete'] as const).filter((op) =>
        operations.includes(op),
      ),
      args: primaryKey,
    }))
    .sort((left, right) => (left.table < right.table ? -1 : 1))

it('installs a trigger on every table and operation the registry listens to', async () => {
  expect(await deployedTriggers()).toEqual(inRegistry())
})

it('has a committed migration that matches the generator', () => {
  const migrations = path.join(__dirname, '../../prisma/schema/migrations')
  const latest = readdirSync(migrations)
    .filter((entry) => entry.endsWith('_db_change_triggers'))
    .sort()
    .at(-1)
  expect(latest).toBeDefined()
  expect(
    readFileSync(path.join(migrations, latest!, 'migration.sql'), 'utf8'),
  ).toBe(dbChangeTriggersSql())
})

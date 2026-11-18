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
    ORDER BY c.relname
  `
  return rows.map((row) => ({
    table: row.table,
    events: [
      row.tgtype & 4 ? 'insert' : null,
      row.tgtype & 16 ? 'update' : null,
      row.tgtype & 8 ? 'delete' : null,
    ].filter((event): event is string => event !== null),
    args: [...row.definition.matchAll(/'([^']*)'/g)].map((match) => match[1]!),
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

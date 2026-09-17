import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import {
  resyncSeededSequences,
  SEQUENCE_BACKED_TABLES_SEEDED_WITH_EXPLICIT_IDS,
} from './resyncSequences.util'
import { PrismaClient } from '../../src/generated/prisma'

const FACTORIES_DIR = join(__dirname, '..', 'factories')
const SCHEMA_DIR = join(__dirname, '..', '..', 'prisma', 'schema')

/**
 * Which factories hand Prisma an `id` of their own, and what table that model
 * maps to — read off the factories and the schema rather than restated, so the
 * list in resyncSequences.util.ts is checked against the thing it is supposed
 * to describe instead of against a copy of itself.
 */
function tablesNeedingResync(): string[] {
  const tables: string[] = []

  for (const file of readdirSync(FACTORIES_DIR)) {
    const match = /^(.+)\.factory\.ts$/.exec(file)
    if (!match) continue

    const factorySource = readFileSync(join(FACTORIES_DIR, file), 'utf8')
    const setsOwnId = /^\s{2,}id:\s/m.test(factorySource)
    if (!setsOwnId) continue

    // Factory file names track the per-model schema file names one-to-one.
    const schemaPath = join(SCHEMA_DIR, `${match[1]}.prisma`)
    const schemaSource = readFileSync(schemaPath, 'utf8')

    // Only a sequence-backed id can fall behind. A uuid/cuid/text primary key
    // written by hand is fine — electedOffice.factory.ts is exactly that case.
    const idIsAutoincrement =
      /^\s*id\s+Int\s+@id\s+@default\(autoincrement\(\)\)/m.test(schemaSource)
    if (!idIsAutoincrement) continue

    const mappedTable = /@@map\("([^"]+)"\)/.exec(schemaSource)?.[1]
    if (!mappedTable) {
      throw new Error(
        `${match[1]}.prisma has no @@map, so its table name cannot be resolved`,
      )
    }
    tables.push(mappedTable)
  }

  return tables.sort()
}

describe('resyncSeededSequences', () => {
  // The failure this guards is silent and delayed: a new factory that invents
  // its own id leaves that sequence behind MAX(id), and nothing goes wrong
  // until someone creates a row of that model in a seeded database. Because
  // the factories draw ids from the full int4 range, the sequence never climbs
  // back out on its own.
  it('covers exactly the sequence-backed tables the factories write ids into', () => {
    expect([...SEQUENCE_BACKED_TABLES_SEEDED_WITH_EXPLICIT_IDS].sort()).toEqual(
      tablesNeedingResync(),
    )
  })

  it('finds the explicit-id factories at all', () => {
    // Guards the assertion above against passing by accident: if the source
    // scan stopped matching (a formatting change, a moved directory), it would
    // return an empty list and agree with an empty constant.
    expect(tablesNeedingResync().length).toBeGreaterThan(0)
  })

  it('resets each sequence to MAX(id) + 1 in a form that is safe on an empty table', async () => {
    const executeRawUnsafe = vi.fn().mockResolvedValue(0)
    const prisma = {
      $executeRawUnsafe: executeRawUnsafe,
    } as unknown as PrismaClient

    await resyncSeededSequences(prisma)

    expect(executeRawUnsafe).toHaveBeenCalledTimes(
      SEQUENCE_BACKED_TABLES_SEEDED_WITH_EXPLICIT_IDS.length,
    )

    for (const [index, table] of [
      ...SEQUENCE_BACKED_TABLES_SEEDED_WITH_EXPLICIT_IDS,
    ].entries()) {
      const sql = executeRawUnsafe.mock.calls[index]?.[0] as string | undefined
      const normalized = (sql ?? '').replace(/\s+/g, ' ')

      expect(normalized).toContain(`pg_get_serial_sequence('"${table}"', 'id')`)
      expect(normalized).toContain(
        `COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1`,
      )
      // `is_called = false` is what makes MAX(id) + 1 the id the NEXT insert
      // receives. With `true` the sequence would be left one ahead, so an
      // empty table would issue 2 first and never use id 1.
      expect(normalized).toContain('false')
    }
  })
})

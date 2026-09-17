import { describe, expect, it } from 'vitest'
import { useTestService } from '../src/test-service'
import {
  backfillTrimUserNames,
  computeTrimmedUpdate,
  type UserNameRow,
} from './trim-user-names'

describe('computeTrimmedUpdate', () => {
  it('returns null when both fields are already clean', () => {
    expect(
      computeTrimmedUpdate({ id: 1, firstName: 'Alice', lastName: 'Doe' }),
    ).toBeNull()
  })

  it('trims a leading-space first name and leaves last name untouched', () => {
    expect(
      computeTrimmedUpdate({ id: 1, firstName: ' Alice', lastName: 'Doe' }),
    ).toEqual({ firstName: 'Alice' })
  })

  it('trims a trailing-space last name and leaves first name untouched', () => {
    expect(
      computeTrimmedUpdate({ id: 1, firstName: 'Alice', lastName: 'Doe ' }),
    ).toEqual({ lastName: 'Doe' })
  })

  it('trims both fields when both are dirty', () => {
    expect(
      computeTrimmedUpdate({
        id: 1,
        firstName: '  Alice ',
        lastName: '\tDoe\n',
      }),
    ).toEqual({ firstName: 'Alice', lastName: 'Doe' })
  })

  it('collapses a whitespace-only name to the empty string', () => {
    expect(
      computeTrimmedUpdate({ id: 1, firstName: '   ', lastName: 'Doe' }),
    ).toEqual({ firstName: '' })
  })

  it('leaves null-valued fields alone rather than writing an empty string', () => {
    expect(
      computeTrimmedUpdate({ id: 1, firstName: null, lastName: ' Doe ' }),
    ).toEqual({ lastName: 'Doe' })
  })

  it('returns null when both fields are null', () => {
    expect(
      computeTrimmedUpdate({ id: 1, firstName: null, lastName: null }),
    ).toBeNull()
  })

  it('does not treat an empty-string field as needing an update', () => {
    expect(
      computeTrimmedUpdate({ id: 1, firstName: '', lastName: '' }),
    ).toBeNull()
  })
})

describe('backfillTrimUserNames against the database', () => {
  const service = useTestService()

  const insertUser = async (row: {
    email: string
    firstName: string | null
    lastName: string | null
  }) => {
    // Prisma trims nothing on its side — the raw insert is what lets us
    // stage the dirty rows that the backfill exists to clean up.
    const [inserted] = await service.prisma.$queryRaw<{ id: number }[]>`
      INSERT INTO "user" (email, first_name, last_name, created_at, updated_at)
      VALUES (${row.email}, ${row.firstName}, ${row.lastName}, NOW(), NOW())
      RETURNING id
    `
    return inserted.id
  }

  const readNames = async (id: number): Promise<UserNameRow> => {
    const [row] = await service.prisma.$queryRaw<UserNameRow[]>`
      SELECT id,
             first_name AS "firstName",
             last_name  AS "lastName"
      FROM "user"
      WHERE id = ${id}
    `
    return row
  }

  it('trims dirty first and last name rows and leaves clean rows untouched', async () => {
    const dirtyBoth = await insertUser({
      email: 'dirty-both@example.com',
      firstName: '  Alice',
      lastName: 'Doe ',
    })
    const dirtyFirst = await insertUser({
      email: 'dirty-first@example.com',
      firstName: '\tBob',
      lastName: 'Smith',
    })
    const dirtyLast = await insertUser({
      email: 'dirty-last@example.com',
      firstName: 'Carol',
      lastName: 'Jones\n',
    })
    const clean = await insertUser({
      email: 'clean@example.com',
      firstName: 'Dan',
      lastName: 'Frost',
    })
    const nullBoth = await insertUser({
      email: 'null-both@example.com',
      firstName: null,
      lastName: null,
    })

    const stats = await backfillTrimUserNames(service.prisma, {
      isDryRun: false,
    })

    expect(stats).toMatchObject({
      scanned: 3,
      trimmed: 3,
      skippedAlreadyClean: 0,
      errors: [],
    })

    expect(await readNames(dirtyBoth)).toMatchObject({
      firstName: 'Alice',
      lastName: 'Doe',
    })
    expect(await readNames(dirtyFirst)).toMatchObject({
      firstName: 'Bob',
      lastName: 'Smith',
    })
    expect(await readNames(dirtyLast)).toMatchObject({
      firstName: 'Carol',
      lastName: 'Jones',
    })
    expect(await readNames(clean)).toMatchObject({
      firstName: 'Dan',
      lastName: 'Frost',
    })
    expect(await readNames(nullBoth)).toMatchObject({
      firstName: null,
      lastName: null,
    })
  })

  it('is idempotent on re-run: a second pass scans zero rows', async () => {
    await insertUser({
      email: 'idempotent@example.com',
      firstName: ' Eve ',
      lastName: ' Adams ',
    })

    const first = await backfillTrimUserNames(service.prisma, {
      isDryRun: false,
    })
    expect(first.trimmed).toBe(1)

    const second = await backfillTrimUserNames(service.prisma, {
      isDryRun: false,
    })
    expect(second).toMatchObject({ scanned: 0, trimmed: 0, errors: [] })
  })

  it('dry-run reports the row without writing', async () => {
    const id = await insertUser({
      email: 'dry-run@example.com',
      firstName: ' Grace',
      lastName: 'Hopper ',
    })

    const stats = await backfillTrimUserNames(service.prisma, {
      isDryRun: true,
    })

    expect(stats).toMatchObject({ scanned: 1, trimmed: 1, errors: [] })

    expect(await readNames(id)).toMatchObject({
      firstName: ' Grace',
      lastName: 'Hopper ',
    })
  })
})

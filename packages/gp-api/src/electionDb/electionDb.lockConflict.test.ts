import { execFileSync } from 'child_process'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { testPostgresUri, withDatabase } from '@/test-postgres'
import { PrismaClient } from '../generated/election-prisma'
import { ElectionDbService, withLockTimeout } from './electionDb.service'

// Replays the 2026-11-02 incident against a real Postgres, because the fix is
// about what Postgres's lock manager does. A stand-in for the nightly swap
// locks one table, a read joining two tables grabs the other and waits, then
// the swap asks for the table the read holds. Before the fix, Postgres broke
// that cycle after 1s by cancelling one side with 40P01.
const DB_NAME = `gp_api_election_lock_${process.pid}`
const PLACE = '00000000-0000-4000-8000-0000000000b1'
const LOCK_CONFLICT_SQLSTATES = ['40P01', '55P03']

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const lockConflictSqlState = (error: unknown) =>
  error instanceof Error
    ? LOCK_CONFLICT_SQLSTATES.find((code) => error.message.includes(code))
    : undefined

type ReadOutcome = { rows?: unknown; error?: unknown }

const settle = (read: () => Promise<unknown>): Promise<ReadOutcome> =>
  read().then(
    (rows) => ({ rows }),
    (error: unknown) => ({ error }),
  )

describe('election-db reads during the nightly swap', () => {
  let admin: Client
  let url: string
  let service: ElectionDbService
  let noRetryClient: PrismaClient

  beforeAll(async () => {
    const baseUri = await testPostgresUri()
    admin = new Client({ connectionString: baseUri })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${DB_NAME}`)
    url = withDatabase(baseUri, DB_NAME)

    const ddl = execFileSync(
      'npx',
      [
        'prisma',
        'migrate',
        'diff',
        '--from-empty',
        '--to-schema-datamodel',
        'prisma-election/schema',
        '--script',
      ],
      { cwd: `${__dirname}/../..`, encoding: 'utf8' },
    )
    const scratch = new Client({ connectionString: url })
    await scratch.connect()
    await scratch.query(ddl)
    await scratch.query(
      `INSERT INTO "Place" (id, br_database_id, name, slug, geoid, mtfcc,
         state, updated_at)
       VALUES ($1, 1, 'LA', 'ca/la', '06037', 'G4020', 'CA', now())`,
      [PLACE],
    )
    await scratch.query(
      `INSERT INTO "Race" (id, election_date, slug, state, position_level,
         position_names, frequency, place_id, updated_at)
       VALUES ($1, '2026-11-03', 'ca/la/judge', 'CA', 'COUNTY', '{}', '{4}',
         $2, now())`,
      ['00000000-0000-4000-8000-0000000000b2', PLACE],
    )
    await scratch.end()

    vi.stubEnv('ELECTION_DATABASE_URL', url)
    service = new ElectionDbService()
    await service.onModuleInit()
    await service.instance.race.count()

    // Same give-up as production, no retry extension: a read that reaches the
    // 1s deadlock check instead of backing off must surface 40P01 here. Warmed
    // like the service client, or a slow first connect outlasts the harness's
    // 100ms head start and the read never meets the swap.
    noRetryClient = new PrismaClient({
      datasources: { db: { url: withLockTimeout(url) } },
    })
    await noRetryClient.race.count()
  })

  afterAll(async () => {
    await noRetryClient?.$disconnect()
    await service?.onModuleDestroy()
    await admin?.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`)
    await admin?.end()
  })

  // Postgres counts every cycle its 1s deadlock check had to break. A read that
  // carries the give-up never creates one; a read that lost it does, and the
  // retry extension then hides that from the row assertion — so this is the
  // service client's evidence that it backed off first.
  const deadlocks = async () => {
    const { rows } = await admin.query(
      'SELECT deadlocks FROM pg_stat_database WHERE datname = $1',
      [DB_NAME],
    )
    return Number(rows[0]?.deadlocks)
  }

  const swapAround = async (
    first: string,
    second: string,
    read: () => Promise<unknown>,
  ) => {
    const swap = new Client({ connectionString: url })
    await swap.connect()
    try {
      await swap.query('BEGIN')
      await swap.query(`LOCK TABLE "${first}" IN ACCESS EXCLUSIVE MODE`)
      // A Prisma query only runs once it is awaited or then'd.
      const outcome = settle(read)
      await sleep(100)
      await swap.query(`LOCK TABLE "${second}" IN ACCESS EXCLUSIVE MODE`)
      await swap.query('COMMIT')
      const settled = await outcome
      return settled
    } finally {
      await swap.end()
    }
  }

  it('backs a joined model read off so the swap commits', async () => {
    const deadlocksBefore = await deadlocks()
    const retried = await swapAround('Place', 'Race', () =>
      service.instance.race.findMany({ include: { Place: true } }),
    )
    expect(retried.error).toBeUndefined()
    expect(retried.rows).toHaveLength(1)
    expect(await deadlocks()).toBe(deadlocksBefore)

    const backedOff = await swapAround('Place', 'Race', () =>
      noRetryClient.race.findMany({ include: { Place: true } }),
    )
    expect(lockConflictSqlState(backedOff.error)).toBe('55P03')
  })

  it('backs a joined raw read off so the swap commits', async () => {
    const deadlocksBefore = await deadlocks()
    const retried = await swapAround(
      'Race',
      'Place',
      () => service.instance.$queryRaw`
        SELECT p.slug, COUNT(r.id)::int AS race_count
        FROM "Place" p LEFT JOIN "Race" r ON r.place_id = p.id
        GROUP BY p.id`,
    )
    expect(retried.error).toBeUndefined()
    expect(retried.rows).toHaveLength(1)
    expect(await deadlocks()).toBe(deadlocksBefore)

    const backedOff = await swapAround(
      'Race',
      'Place',
      () => noRetryClient.$queryRaw`
        SELECT p.slug, COUNT(r.id)::int AS race_count
        FROM "Place" p LEFT JOIN "Race" r ON r.place_id = p.id
        GROUP BY p.id`,
    )
    expect(lockConflictSqlState(backedOff.error)).toBe('55P03')
  })
})

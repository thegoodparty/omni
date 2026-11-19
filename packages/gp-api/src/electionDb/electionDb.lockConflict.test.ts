import { execFileSync } from 'child_process'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { testPostgresUri, withDatabase } from '@/test-postgres'
import { ElectionDbService } from './electionDb.service'

// Replays the 2026-11-02 incident against a real Postgres, because the fix is
// about what Postgres's lock manager does. A stand-in for the nightly swap
// locks one table, a read joining two tables grabs the other and waits, then
// the swap asks for the table the read holds. Before the fix, Postgres broke
// that cycle after 1s by cancelling one side with 40P01.
const DB_NAME = `gp_api_election_lock_${process.pid}`
const PLACE = '00000000-0000-4000-8000-0000000000b1'
// The read gives up at 200ms, so the swap waits about 100ms after asking for
// its second table. Without that, the read sits in the cycle until Postgres's
// 1s deadlock check cancels it, and the swap waits about 900ms.
const SWAP_WAIT_LIMIT_MS = 500

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('election-db reads during the nightly swap', () => {
  let admin: Client
  let url: string
  let service: ElectionDbService

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
  })

  afterAll(async () => {
    await service?.onModuleDestroy()
    await admin?.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`)
    await admin?.end()
  })

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
      const result = Promise.resolve(read())
      await sleep(100)
      const started = Date.now()
      await swap.query(`LOCK TABLE "${second}" IN ACCESS EXCLUSIVE MODE`)
      const swapWaitedMs = Date.now() - started
      await swap.query('COMMIT')
      return { rows: await result, swapWaitedMs }
    } finally {
      await swap.end()
    }
  }

  it('backs a joined model read off so the swap commits', async () => {
    const { rows, swapWaitedMs } = await swapAround('Place', 'Race', () =>
      service.instance.race.findMany({ include: { Place: true } }),
    )
    expect(rows).toHaveLength(1)
    expect(swapWaitedMs).toBeLessThan(SWAP_WAIT_LIMIT_MS)
  })

  it('backs a joined raw read off so the swap commits', async () => {
    const { rows, swapWaitedMs } = await swapAround(
      'Race',
      'Place',
      () => service.instance.$queryRaw`
        SELECT p.slug, COUNT(r.id)::int AS race_count
        FROM "Place" p LEFT JOIN "Race" r ON r.place_id = p.id
        GROUP BY p.id`,
    )
    expect(rows).toHaveLength(1)
    expect(swapWaitedMs).toBeLessThan(SWAP_WAIT_LIMIT_MS)
  })
})

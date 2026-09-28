import { NestFastifyApplication } from '@nestjs/platform-fastify'
import axios, { AxiosInstance } from 'axios'
import { randomBytes } from 'crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import { bootstrap } from './app'
import { PrismaService } from './prisma/prisma.service'
import {
  LOOPBACK_HOSTS,
  TEMPLATE_LOCK_KEY,
  TEST_POOL_LIMIT,
  templateDbName,
  testPostgresUri,
  withDatabase,
} from './test-postgres'

// The drop below is the only thing that keeps a shared server from
// accumulating one database per suite, so it must not be the hook that gets
// cut off. vitest's 10s default already trips under a full-suite run on a
// contended machine, and a tripped afterAll leaks the clone it was dropping.
const DROP_TIMEOUT_MS = 60_000

export type TestServiceContext = {
  /**
   * An Axios client targeting the booted test service (base URL includes the
   * port), sending a Bearer token so it clears the default-deny M2MAuthGuard —
   * i.e. it behaves as an authenticated service-to-service caller, which is the
   * only way these endpoints are reachable in production.
   */
  client: AxiosInstance

  /**
   * An Axios client with no Authorization header, for asserting the guard's
   * default-deny behaviour (every non-@PublicAccess route 401s without a token).
   */
  unauthedClient: AxiosInstance

  /** The NestJS application instance. */
  app: NestFastifyApplication

  /** The PrismaService bound to the per-suite testcontainer database. */
  prisma: PrismaService
}

/**
 * Integration harness for election-api, mirroring gp-api's `useTestService`.
 *
 * Boots the real Nest Fastify app (same `bootstrap` as production) against a
 * throwaway Postgres database, so tests exercise the genuine Prisma
 * queries — including the PII `omit`/column-allowlist behaviour on the
 * M2M-protected persons/officeholders endpoints — over real HTTP. `client`
 * sends a Bearer token (Clerk verify is stubbed in test-setup.ts) so it clears
 * the default-deny guard; use `unauthedClient` to assert the guard rejects.
 *
 * @example
 * ```typescript
 * import { expect, test } from 'vitest'
 * import { useTestService } from './test-service'
 *
 * const service = useTestService()
 *
 * test('lists persons', async () => {
 *   const res = await service.client.get('/v1/persons')
 *   expect(res.status).toBe(200)
 * })
 * ```
 */
export const useTestService = (): TestServiceContext => {
  let app: NestFastifyApplication
  let client: AxiosInstance
  let unauthedClient: AxiosInstance
  let baseConnectionUri: string
  let uniqueDbName: string

  beforeAll(async () => {
    baseConnectionUri = await testPostgresUri()

    // Unique DB per suite keeps suites isolated on the one shared server.
    uniqueDbName = `test_db_${randomBytes(8).toString('hex')}`

    // Clone the schema template that globalSetup built once, rather than
    // replaying every migration here. The copy is a near-instant Postgres
    // operation, which keeps suites off a per-suite migration replay.
    //
    // Held in shared mode against globalSetup's exclusive lock, so a clone
    // can never read a template that is still being built.
    const admin = new Client({ connectionString: baseConnectionUri })
    await admin.connect()
    try {
      await admin.query(`SELECT pg_advisory_lock_shared(${TEMPLATE_LOCK_KEY})`)
      await admin.query(
        `CREATE DATABASE ${uniqueDbName} TEMPLATE ${templateDbName()}`,
      )
    } finally {
      await admin.query(
        `SELECT pg_advisory_unlock_shared(${TEMPLATE_LOCK_KEY})`,
      )
      await admin.end()
    }

    const cloneUri = withDatabase(baseConnectionUri, uniqueDbName)
    const databaseUrl = `${cloneUri}?connection_limit=${TEST_POOL_LIMIT}`

    // DB SAFETY: verify (and print) that Prisma will only ever point at a local
    // host before we hand the URL to the app. Fail loudly otherwise.
    const host = new URL(databaseUrl).hostname
    // eslint-disable-next-line no-console
    console.log(`[election-api integration] DATABASE_URL host=${host}`)
    if (!LOOPBACK_HOSTS.includes(host)) {
      throw new Error(
        `Refusing to boot the harness against a non-local database (host=${host}).`,
      )
    }

    // PrismaService reads DATABASE_URL in its constructor, so this must be set
    // before the app (and its PrismaService) is instantiated.
    process.env.DATABASE_URL = databaseUrl

    app = await bootstrap({ loggingEnabled: false })

    // Listen on a random free port bound to loopback only.
    await app.listen({ port: 0, host: '127.0.0.1' })

    const address = app.getHttpServer().address()
    const port =
      typeof address === 'string'
        ? 3000
        : // @ts-expect-error - address is not well-typed
          address.port

    const baseURL = `http://127.0.0.1:${port}`
    // We frequently assert on non-2xx status codes (404/400), so disable Axios
    // throwing and let tests assert status explicitly.
    const validateStatus = () => true

    // The token value is irrelevant — test-setup.ts stubs Clerk's verify to
    // accept any token — but it must be present so the guard doesn't 401.
    client = axios.create({
      baseURL,
      validateStatus,
      headers: { Authorization: 'Bearer test-m2m-token' },
    })
    unauthedClient = axios.create({ baseURL, validateStatus })
  }, 60_000)

  beforeEach(async () => {
    const prisma = app.get(PrismaService)

    // Empty every table before each test to isolate individual tests.
    const tableNames = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname='public'
    `
    if (tableNames.length > 0) {
      const tableList = tableNames
        .map(({ tablename }) => `"public"."${tablename}"`)
        .join(', ')
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} CASCADE;`)
    }
  })

  afterAll(async () => {
    if (app) {
      await app.close()
    }

    // Drop this suite's clone. Nothing else does, so a reused server
    // otherwise carries every database every suite ever created. FORCE covers
    // any connection app.close() left behind.
    if (!baseConnectionUri) return
    const admin = new Client({ connectionString: baseConnectionUri })
    await admin.connect()
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${uniqueDbName} WITH (FORCE)`)
    } finally {
      await admin.end()
    }
  }, DROP_TIMEOUT_MS)

  return {
    get client() {
      return client
    },
    get unauthedClient() {
      return unauthedClient
    },
    get app() {
      return app
    },
    get prisma() {
      return app.get(PrismaService)
    },
  }
}

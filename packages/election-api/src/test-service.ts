import { NestFastifyApplication } from '@nestjs/platform-fastify'
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import axios, { AxiosInstance } from 'axios'
import { randomBytes } from 'crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import { bootstrap } from './app'
import { PrismaService } from './prisma/prisma.service'
import { TEMPLATE_DB, startTestPostgres } from './test-postgres'

export type TestServiceContext = {
  /** An Axios client targeting the booted test service (base URL includes the port). */
  client: AxiosInstance

  /** The NestJS application instance. */
  app: NestFastifyApplication

  /** The PrismaService bound to the per-suite testcontainer database. */
  prisma: PrismaService
}

/**
 * Integration harness for election-api, mirroring gp-api's `useTestService`.
 *
 * Boots the real Nest Fastify app (same `bootstrap` as production) against a
 * throwaway Postgres testcontainer, so tests exercise the genuine Prisma
 * queries — including the PII `omit`/column-allowlist behaviour on the public
 * persons/officeholders endpoints — over real HTTP.
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

  beforeAll(async () => {
    const container: StartedPostgreSqlContainer = await startTestPostgres()
    const baseConnectionUri = container.getConnectionUri()

    // Unique DB per suite keeps suites isolated on the one shared container.
    const uniqueDbName = `test_db_${randomBytes(8).toString('hex')}`

    // Clone the schema template that globalSetup built once, rather than
    // replaying every migration here. The copy is a near-instant Postgres
    // operation, which keeps suites off a per-suite migration replay.
    const admin = new Client({ connectionString: baseConnectionUri })
    await admin.connect()
    await admin.query(`CREATE DATABASE ${uniqueDbName} TEMPLATE ${TEMPLATE_DB}`)
    await admin.end()

    const databaseUrl = baseConnectionUri.replace(
      '/postgres',
      `/${uniqueDbName}`,
    )

    // DB SAFETY: verify (and print) that Prisma will only ever point at a local
    // host before we hand the URL to the app. Fail loudly otherwise.
    const host = new URL(databaseUrl).hostname
    // eslint-disable-next-line no-console
    console.log(`[election-api integration] DATABASE_URL host=${host}`)
    if (host !== 'localhost' && host !== '127.0.0.1') {
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

    client = axios.create({
      baseURL: `http://127.0.0.1:${port}`,
      // We frequently assert on non-2xx status codes (404/400), so disable
      // Axios throwing and let tests assert status explicitly.
      validateStatus: () => true,
    })
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
  })

  return {
    get client() {
      return client
    },
    get app() {
      return app
    },
    get prisma() {
      return app.get(PrismaService)
    },
  }
}

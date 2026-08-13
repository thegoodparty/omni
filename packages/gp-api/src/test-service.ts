import { UnauthorizedException } from '@nestjs/common'
import { NestFastifyApplication } from '@nestjs/platform-fastify'
import { User } from './generated/prisma'
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import axios, { AxiosInstance } from 'axios'
import { randomBytes } from 'crypto'
import jwt from 'jsonwebtoken'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, vi } from 'vitest'
import { bootstrap } from './app'
import {
  AUTH_PROVIDER_TOKEN,
  AuthProvider,
} from './authentication/interfaces/auth-provider.interface'
import './configrc'
import { PrismaService } from './prisma/prisma.service'
import {
  TEMPLATE_DB,
  TEMPLATE_LOCK_KEY,
  startTestPostgres,
} from './test-postgres'
import { ClerkUserEnricherService } from './vendors/clerk/services/clerk-user-enricher.service'
import { ElectionApiTokenService } from './vendors/clerk/services/electionApiToken.service'

export const TEST_CLERK_ID = 'user_test_123'

/**
 * What ClerkUserEnricherService resolves to when Clerk cannot be reached: the
 * DB identity fields stand, but a locally stored avatar is never served as if
 * it were Clerk's.
 */
const dropClerkAvatar = <T extends object>(user: T): T =>
  'avatar' in user ? { ...user, avatar: null } : user

export type TestServiceContext = {
  /** A client targeting the test service. */
  client: AxiosInstance

  /** The NestJS application instance. */
  app: NestFastifyApplication

  /** The user currently logged in to the test service. */
  user: User

  /** A Prisma client instance. */
  prisma: PrismaService
}

/**
 * Provides an abstraction for testing the NestJS API via a test harness. Provides an
 * Axios client that can be used to make requests to the test service, which is backed
 * by a "real" Postgres database in Docker.
 *
 * @example
 * ```typescript
 * import { expect, test } from 'vitest'
 * import { useTestService } from './test-service'
 *
 * const service = useTestService()
 *
 * test('should fetch posts', async () => {
 *   const result = await service.client.get('/v1/posts')
 *   expect(result.status).toBe(200)
 * })
 * ```
 */
export const useTestService = (): TestServiceContext => {
  let container: StartedPostgreSqlContainer
  let app: NestFastifyApplication
  let client: AxiosInstance
  let user: User

  beforeAll(async () => {
    // Generate unique database name for this test suite. It's important to use unique
    // database names per suite to ensure that suites are isolated from each other.
    const uniqueDbName = `test_db_${randomBytes(8).toString('hex')}`

    container = await startTestPostgres()

    const baseConnectionUri = container.getConnectionUri()

    // Clone the schema template that globalSetup built once, rather than
    // replaying every migration here. The copy is a near-instant Postgres
    // operation, which is what keeps 60+ suites off a per-suite migration
    // replay against the one shared container.
    //
    // Held in shared mode: a concurrent vitest run process's globalSetup can
    // be rebuilding this same template (see test-global-setup.ts) right now.
    // The shared lock blocks only while that rebuild's exclusive lock is
    // held, so the clone can't land against a template mid-drop/rebuild.
    const admin = new Client({ connectionString: baseConnectionUri })
    await admin.connect()
    try {
      await admin.query(`SELECT pg_advisory_lock_shared(${TEMPLATE_LOCK_KEY})`)
      await admin.query(
        `CREATE DATABASE ${uniqueDbName} TEMPLATE ${TEMPLATE_DB}`,
      )
    } finally {
      await admin.query(
        `SELECT pg_advisory_unlock_shared(${TEMPLATE_LOCK_KEY})`,
      )
      await admin.end()
    }

    const databaseUrl = baseConnectionUri.replace(
      '/postgres',
      `/${uniqueDbName}`,
    )
    // Set DATABASE_URL for Prisma with the unique database
    process.env.DATABASE_URL = databaseUrl

    // Create NestJS application using the same bootstrap function as production
    app = await bootstrap({ loggingEnabled: false })

    const authProvider = app.get<AuthProvider>(AUTH_PROVIDER_TOKEN)
    // .bind() returns any — TypeScript cannot infer the bound method signature
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const realVerifySessionToken: AuthProvider['verifySessionToken'] =
      authProvider.verifySessionToken.bind(authProvider)
    vi.spyOn(authProvider, 'verifySessionToken').mockImplementation(
      async (token: string) => {
        // Broker-signed agent tokens verify locally with no Clerk dependency,
        // so delegate to the real method and exercise the production branch.
        const unverified = jwt.decode(token)
        if (
          typeof unverified === 'object' &&
          unverified !== null &&
          unverified.iss === 'gp-broker'
        ) {
          return realVerifySessionToken(token)
        }
        const decoded = jwt.verify(token, process.env.AUTH_SECRET!)
        const sub = typeof decoded === 'object' ? decoded.sub : undefined
        if (!sub) {
          throw new UnauthorizedException('Invalid test token')
        }
        return { externalUserId: sub }
      },
    )

    // election-api calls now require a Clerk M2M token (ElectionApiTokenService).
    // Route tests don't set GP_API_MACHINE_SECRET and stub the election-api HTTP
    // calls anyway, so stub the token — otherwise authHeader() throws and every
    // election-api-backed endpoint (e.g. district resolution behind contacts
    // count) returns a 502.
    const electionApiTokenService = app.get(ElectionApiTokenService)
    vi.spyOn(electionApiTokenService, 'authHeader').mockResolvedValue({
      Authorization: 'Bearer test-election-api-token',
    })

    // SessionGuard enriches the request user through Clerk on every
    // authenticated call, so unstubbed this is a live round trip to
    // api.clerk.com per request. It can only ever 401, since .env.test carries
    // a placeholder CLERK_SECRET_KEY. The guard and enrichUser/enrichUsers
    // absorb that 401 by keeping the DB fields and dropping the avatar, so
    // resolve to that outcome directly instead. The enricher's own behavior
    // stays covered by clerk-user-enricher.service.test.ts, which mocks the
    // Clerk client rather than the service.
    const enricher = app.get(ClerkUserEnricherService)
    vi.spyOn(enricher, 'fetchClerkFields').mockResolvedValue(null)
    vi.spyOn(enricher, 'enrichUser').mockImplementation((user) =>
      Promise.resolve(dropClerkAvatar(user)),
    )
    vi.spyOn(enricher, 'enrichUsers').mockImplementation((users) =>
      Promise.resolve(users.map(dropClerkAvatar)),
    )

    // Start the application on a random available port
    await app.listen({ port: 0, host: '127.0.0.1' })

    // Get the actual port the app is listening on
    const address = app.getHttpServer().address()
    const port =
      typeof address === 'string'
        ? 3000
        : // @ts-expect-error - address is not well-ttyped
          address.port

    // Create Axios client targeting the test server
    client = axios.create({
      baseURL: `http://127.0.0.1:${port}`,
      // We should frequently be testing for non-200 status codes. So, disable
      // automatic throwing on status codes, in favor of using explicit assertions
      // for success/failure in the test code.
      validateStatus: () => true,
    })

    // Add a user authentication token to every request
    client.interceptors.request.use((config) => {
      if (!config.headers.Authorization) {
        const authToken = jwt.sign(
          { sub: TEST_CLERK_ID, email: user.email },
          process.env.AUTH_SECRET!,
          { expiresIn: '1h' },
        )
        config.headers.Authorization = `Bearer ${authToken}`
      }
      return config
    })
  }, 25_000)

  beforeEach(async () => {
    const prisma = app.get(PrismaService)

    // Get all table names from the Prisma schema
    const tableNames = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname='public'
    `

    // Empty every table before each test run to isolate individual tests
    // within a suite. Truncate all tables in a single statement for better performance.
    if (tableNames.length > 0) {
      const tableList = tableNames
        .map(({ tablename }) => `"public"."${tablename}"`)
        .join(', ')
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} CASCADE;`)
    }

    // Create a test user for the current test
    user = await prisma.user.create({
      data: {
        id: 123,
        clerkId: TEST_CLERK_ID,
        email: 'tests@goodparty.org',
        firstName: 'Johnny',
        lastName: 'Goodparty',
      },
    })
  })

  afterAll(async () => {
    // Close the NestJS application
    if (app) {
      await app.close()
    }
  })

  // Return the context object
  // Note: This object is returned immediately, but the actual values
  // (client, app, etc.) are populated in the before hook
  return {
    get client() {
      return client
    },

    get app() {
      return app
    },

    get user() {
      return user
    },

    get prisma() {
      return app.get(PrismaService)
    },
  }
}

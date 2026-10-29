import { UnauthorizedException } from '@nestjs/common'
import { NestFastifyApplication } from '@nestjs/platform-fastify'
import { User } from './generated/prisma'
import axios, { AxiosInstance } from 'axios'
import { randomBytes } from 'crypto'
import jwt from 'jsonwebtoken'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, expect, inject, vi } from 'vitest'
import { bootstrap } from './app'
import {
  AUTH_PROVIDER_TOKEN,
  AuthProvider,
} from './authentication/interfaces/auth-provider.interface'
import './configrc'
import { PrismaService } from './prisma/prisma.service'
import {
  TEMPLATE_LOCK_KEY,
  TEST_POOL_LIMIT,
  templateDbName,
  testPostgresUri,
  withDatabase,
} from './test-postgres'
import { ElectionsService } from './elections/services/elections.service'
import { District } from './elections/types/elections.types'
import { NestContainer } from '@nestjs/core/injector/container'
import { appEnvOverrides } from './shared/test-utils/appEnvOverrides'
import { appendFileSync, mkdirSync } from 'fs'

const PROFILE_DIR = process.env.BOOT_PROFILE_DIR
type ProfileMarks = Array<[string, number]>
declare global {
  var __bootMarks: ProfileMarks | undefined
}
declare global {
  var __testServiceLoads: number | undefined
}
globalThis.__testServiceLoads = (globalThis.__testServiceLoads ?? 0) + 1
const mark = (name: string) => {
  if (PROFILE_DIR) globalThis.__bootMarks?.push([name, performance.now()])
}
const flushProfile = (file: string) => {
  if (!PROFILE_DIR || !globalThis.__bootMarks) return
  mkdirSync(PROFILE_DIR, { recursive: true })
  appendFileSync(
    `${PROFILE_DIR}/${process.pid}.jsonl`,
    JSON.stringify({ file, loads: globalThis.__testServiceLoads, marks: globalThis.__bootMarks }) + '\n',
  )
  globalThis.__bootMarks = undefined
}

export const TEST_CLERK_ID = 'user_test_123'
export const TEST_M2M_JWT_SUBJECT = 'mch_test_machine'

// Stands in for a Clerk JWT-format M2M token. The harness verifies it with
// AUTH_SECRET instead of the Clerk JWKS; see the verifyM2MJwt stub below.
export const signTestM2MJwt = (): string =>
  jwt.sign({ sub: TEST_M2M_JWT_SUBJECT }, process.env.AUTH_SECRET!, {
    expiresIn: '1h',
    jwtid: 'm2m_test_jwt',
  })

// The reset below is a few tens of milliseconds of work. This ceiling is here
// only to survive real pathology (a starved runner, a lock held by work that
// outlived the test that started it) — vitest's 10s default was tight enough
// that ordinary CI contention tripped it, and a tripped reset is what starts
// the cascade that `pendingReset` guards against.
const RESET_TIMEOUT_MS = 30_000

// Both the clone in beforeAll and the drop in afterAll contend with every
// other run on a shared server, and a tripped afterAll leaks the clone it was
// dropping — the one thing that keeps that server from accumulating a
// database per suite. vitest's 10s default already trips on a contended
// machine during a full-suite run. This is a ceiling for pathology, not a
// budget.
const HOOK_TIMEOUT_MS = 60_000

declare module 'vitest' {
  export interface ProvidedContext {
    testPostgresUri: string
    testRunId: string
    reuseTestApp: boolean
  }
}

const cloneTemplate = async (baseUri: string, name: string) => {
  // Clone the schema template that globalSetup built once, rather than
  // replaying every migration here. The copy is a near-instant Postgres
  // operation, which is what keeps 60+ suites off a per-suite migration
  // replay against the one shared container.
  //
  // Held in shared mode against globalSetup's exclusive lock. Nothing
  // rebuilds a template in place any more, but globalSetup does sweep
  // superseded ones, and this is what stops a sweep dropping the template
  // this clone is reading.
  const admin = new Client({ connectionString: baseUri })
  await admin.connect()
  mark('adminConnect')
  try {
    await admin.query(`SELECT pg_advisory_lock_shared(${TEMPLATE_LOCK_KEY})`)
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${templateDbName()}`)
  } finally {
    await admin.query(`SELECT pg_advisory_unlock_shared(${TEMPLATE_LOCK_KEY})`)
    await admin.end()
  }
}

// One server serves every checkout on the machine, so the pool Prisma
// would size itself (cores * 2 + 1 per worker) lets concurrent runs
// exhaust max_connections.
const databaseUrlFor = (baseUri: string, name: string) =>
  `${withDatabase(baseUri, name)}?connection_limit=${TEST_POOL_LIMIT}`

// The shared-modules project runs many files in one worker with one module
// graph, so this module's state lives as long as the worker. One database and
// one booted app then serve every file the worker runs: the per-test reset
// already empties every table, so a fresh clone and a fresh boot per file
// bought nothing but ~1s of setup. The worker's database is dropped by
// globalSetup's teardown, not here, because no hook runs when a worker exits.
type WorkerDb = { name: string; tables: string[]; sequences: string[] }
let workerDb: Promise<WorkerDb> | undefined

type InstanceSnapshot = {
  instance: Record<string | symbol, unknown>
  descriptors: PropertyDescriptorMap
  collections: Array<
    | { map: Map<unknown, unknown>; entries: Array<[unknown, unknown]> }
    | { set: Set<unknown>; values: unknown[] }
  >
}
type SharedApp = {
  app: NestFastifyApplication
  bootKey: string
  port: number
  snapshots: InstanceSnapshot[]
}
let sharedApp: SharedApp | undefined

// Anything a provider reads from the environment while booting is fixed for
// the life of the app, so a file that changes the environment before it boots
// (vi.stubEnv at the top, useAppEnvOverrides) gets its own app instead of the
// shared one.
const IGNORED_ENV = new Set(['DATABASE_URL', 'TEST_SCHEDULER'])
const currentBootKey = () =>
  JSON.stringify({
    env: Object.entries(process.env)
      .filter(([key]) => !IGNORED_ENV.has(key) && !key.startsWith('VITEST'))
      .sort(([a], [b]) => a.localeCompare(b)),
    appEnvOverrides,
  })

const appInstances = (app: NestFastifyApplication) => {
  const container = (app as unknown as { container: NestContainer }).container
  const instances = new Set<Record<string | symbol, unknown>>()
  for (const mod of container.getModules().values()) {
    for (const wrappers of [mod.providers, mod.controllers, mod.injectables]) {
      for (const wrapper of wrappers.values()) {
        const { instance } = wrapper
        // PrismaClient is a Proxy over lazily built model delegates; nothing a
        // test does to it is per-file state.
        if (instance instanceof PrismaService) continue
        if (instance && typeof instance === 'object') {
          instances.add(instance as Record<string | symbol, unknown>)
        }
      }
    }
  }
  return [...instances]
}

// What a file leaves on a singleton (a reassigned field, an
// Object.defineProperty, a filled cache or rate-limit bucket) would otherwise
// reach every later file in the worker. Each file starts from the state the
// providers had right after boot: own properties and the contents of Maps and
// Sets they hold directly. Deeper state (a vendor client's internals) is not
// covered.
const snapshotInstances = (app: NestFastifyApplication): InstanceSnapshot[] =>
  appInstances(app).map((instance) => ({
    instance,
    descriptors: Object.getOwnPropertyDescriptors(instance),
    collections: Reflect.ownKeys(instance).flatMap((key) => {
      const value = instance[key]
      if (value instanceof Map) return [{ map: value, entries: [...value] }]
      if (value instanceof Set) return [{ set: value, values: [...value] }]
      return []
    }),
  }))

const restoreInstances = (snapshots: InstanceSnapshot[]) => {
  for (const { instance, descriptors, collections } of snapshots) {
    for (const key of Reflect.ownKeys(instance)) {
      if (!(key in descriptors)) delete instance[key]
    }
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = descriptors[key as string]
      const current = Object.getOwnPropertyDescriptor(instance, key)
      const changed =
        !current ||
        current.value !== descriptor.value ||
        current.get !== descriptor.get ||
        current.set !== descriptor.set
      if (changed && (descriptor.configurable || descriptor.writable)) {
        Object.defineProperty(instance, key, descriptor)
      }
    }
    for (const collection of collections) {
      if ('map' in collection) {
        collection.map.clear()
        for (const [k, v] of collection.entries) collection.map.set(k, v)
      } else {
        collection.set.clear()
        for (const v of collection.values) collection.set.add(v)
      }
    }
  }
}

const listenOnRandomPort = async (app: NestFastifyApplication) => {
  // Start the application on a random available port
  await app.listen({ port: 0, host: '127.0.0.1' })
  // Get the actual port the app is listening on
  const address = app.getHttpServer().address()
  return typeof address === 'string' || !address ? 3000 : address.port
}

/**
 * Empty every table, then seed the one user the suite authenticates as.
 *
 * DELETE, not TRUNCATE. A test leaves a handful of rows, and TRUNCATE swaps
 * in a new relation file for every table it touches, which invalidates each
 * pooled connection's cached view of those tables and costs ~55ms a reset
 * plus slower queries after it. DELETE on 88 near-empty tables is ~5ms in one
 * round trip. Replica mode skips the foreign key checks, so order does not
 * matter; every table is emptied, so nothing is left dangling.
 */
const resetDatabase = async (
  prisma: PrismaService,
  tables: string[],
): Promise<User> => {
  if (tables.length > 0) {
    await prisma.$executeRawUnsafe(
      `DO $$ BEGIN SET LOCAL session_replication_role = replica; ` +
        tables.map((table) => `DELETE FROM "public"."${table}";`).join(' ') +
        ` END $$`,
    )
  }

  return prisma.user.create({
    data: {
      id: 123,
      clerkId: TEST_CLERK_ID,
      email: 'tests@goodparty.org',
      firstName: 'Johnny',
      lastName: 'Goodparty',
    },
  })
}

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
export type TestServiceOptions = {
  /**
   * Register the app's `@Cron`, `@Interval` and `@Timeout` jobs and let them
   * fire on real timers. Off by default, so no job writes rows mid-suite; a
   * test runs a job by calling its method on the service instead.
   */
  scheduler?: boolean
}

export const useTestService = ({
  scheduler = false,
}: TestServiceOptions = {}): TestServiceContext => {
  let baseConnectionUri: string
  let app: NestFastifyApplication
  let client: AxiosInstance
  let user: User
  let uniqueDbName: string
  let tables: string[] = []
  let ownsApp = false
  let ownsDatabase = false

  // When a hook exceeds its timeout vitest rejects the hook's promise but
  // cannot cancel the queries already in flight, so an abandoned reset runs to
  // completion regardless. Unordered, its user insert lands after the NEXT
  // test's delete and every later test in the file dies on a duplicate id —
  // which is how one slow reset used to fail a whole file. Chaining keeps an
  // abandoned reset strictly ahead of its successor, so it costs one test.
  let pendingReset: Promise<unknown> = Promise.resolve()

  beforeAll(async () => {
    if (PROFILE_DIR) globalThis.__bootMarks = []
    mark('start')

    baseConnectionUri = inject('testPostgresUri') ?? (await testPostgresUri())
    mark('testPostgresUri')

    // A scheduler app fires jobs on real timers, so it must not outlive its
    // file; the fresh-modules project re-imports the app graph per file, so a
    // shared app there would be built from another file's modules.
    const reuse = inject('reuseTestApp') === true && !scheduler

    if (!reuse) {
      // Generate unique database name for this test suite. It's important to use unique
      // database names per suite to ensure that suites are isolated from each other.
      uniqueDbName = `test_db_${randomBytes(8).toString('hex')}`
      await cloneTemplate(baseConnectionUri, uniqueDbName)
      ownsDatabase = true
      process.env.DATABASE_URL = databaseUrlFor(baseConnectionUri, uniqueDbName)
    } else {
      workerDb ??= (async () => {
        const name = `test_db_${inject('testRunId')}_${randomBytes(4).toString('hex')}`
        await cloneTemplate(baseConnectionUri, name)
        const db = new Client({
          connectionString: withDatabase(baseConnectionUri, name),
        })
        await db.connect()
        try {
          // Read once: the database is cloned from the template and never
          // migrated again, so the reset would otherwise re-ask for the same
          // 88 names before every single test.
          const tableRows = await db.query<{ tablename: string }>(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
          )
          const sequenceRows = await db.query<{ name: string }>(
            "SELECT format('%I.%I', schemaname, sequencename) AS name FROM pg_sequences WHERE schemaname = 'public'",
          )
          return {
            name,
            tables: tableRows.rows.map(({ tablename }) => tablename),
            sequences: sequenceRows.rows.map(({ name }) => name),
          }
        } finally {
          await db.end()
        }
      })()
      const db = await workerDb
      tables = db.tables
      process.env.DATABASE_URL = databaseUrlFor(baseConnectionUri, db.name)
    }
    mark('cloneDb')

    // Read by AppModule's ScheduleModule factory during bootstrap.
    process.env.TEST_SCHEDULER = scheduler ? 'on' : 'off'

    const bootKey = currentBootKey()
    let port: number
    if (reuse && sharedApp?.bootKey === bootKey) {
      app = sharedApp.app
      port = sharedApp.port
      restoreInstances(sharedApp.snapshots)
      mark('bootstrapReturned')
      mark('appInit')
    } else {
      // Create NestJS application using the same bootstrap function as production
      app = await bootstrap({ loggingEnabled: false })
      mark('bootstrapReturned')
      await app.init()
      mark('appInit')
      port = await listenOnRandomPort(app)
      if (reuse && !sharedApp) {
        sharedApp = { app, bootKey, port, snapshots: snapshotInstances(app) }
      } else {
        ownsApp = true
      }
    }

    if (reuse) {
      // A fresh clone starts every sequence at 1, and a test may lean on that
      // for the ids of the rows it creates first.
      const { sequences } = await workerDb!
      if (sequences.length > 0) {
        await app
          .get(PrismaService)
          .$executeRawUnsafe(
            `SELECT ${sequences.map((seq) => `setval('${seq}', 1, false)`).join(', ')}`,
          )
      }
    }

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

    vi.spyOn(authProvider, 'verifyM2MJwt').mockImplementation(
      async (token: string) => {
        const decoded = jwt.verify(token, process.env.AUTH_SECRET!)
        if (typeof decoded !== 'object' || !decoded.sub?.startsWith('mch_')) {
          throw new UnauthorizedException('Invalid test M2M JWT')
        }
        return { id: decoded.jti ?? '', subject: decoded.sub }
      },
    )

    // Stub the two election lookups route tests reach through. These used to
    // be HTTP calls to election-api and are now in-process reads against the
    // election database, which no test has: ElectionDbService fails soft at
    // boot and `.instance` throws at query time, so without these every route
    // that resolves a district (door-knocking, phone-banking, outreach — 138
    // tests) would fail.
    //
    // Both are only reached when the org carries the corresponding id, so this
    // cannot manufacture a district for an org that has none — the "no
    // position/district" paths still resolve to null. The L2 fields are what
    // make VoterFileDownloadAccess.canDownload eligible, which is what the live
    // service used to return here. A suite needing specific data re-spies these
    // and its own mock wins.
    const electionsService = app.get(ElectionsService)
    vi.spyOn(electionsService, 'getDistrict').mockImplementation(
      (id: string): Promise<District> =>
        Promise.resolve({
          id,
          state: 'IL',
          L2DistrictType: 'City Council',
          L2DistrictName: 'District 1',
        }),
    )
    // Null rather than a synthetic position: the ids these suites invent do
    // not exist upstream, so "not found" is what the live service already gave
    // them, and callers fall back to campaign.details (normalizedOffice,
    // ballotLevel) accordingly. Manufacturing one here would silently take that
    // fallback away. Suites that need a real position stub it themselves.
    vi.spyOn(electionsService, 'getPositionById').mockResolvedValue(null)

    mark('spies')
    mark('listen')

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

    if (!reuse) {
      // Read once: the database is cloned from the template and never migrated
      // again, so the reset would otherwise re-ask for the same 88 names before
      // every single test.
      tables = (
        await app.get(PrismaService).$queryRaw<Array<{ tablename: string }>>`
          SELECT tablename FROM pg_tables WHERE schemaname = 'public'
        `
      ).map(({ tablename }) => tablename)
    }
    mark('tablesQuery')
  }, HOOK_TIMEOUT_MS)

  beforeEach(async () => {
    const reset = pendingReset
      .catch(() => undefined)
      .then(() => resetDatabase(app.get(PrismaService), tables))
    // Keep the chain itself settled, so one failed reset doesn't reject every
    // reset after it.
    pendingReset = reset.catch(() => undefined)
    user = await reset
  }, RESET_TIMEOUT_MS)

  afterAll(async () => {
    mark('afterAllStart')
    // Close the NestJS application
    if (app && ownsApp) {
      await app.close()
    }
    mark('appClose')

    // Drop this suite's clone. Nothing else does, so a reused container
    // otherwise carries every database every suite ever created — a long-lived
    // local one had accumulated 248 — and autovacuum keeps working through all
    // of them, which is what leaves a "warm" container measurably slower to
    // test against than a fresh one. FORCE covers any connection app.close()
    // left behind.
    if (!baseConnectionUri || !ownsDatabase) {
      mark('dropDb')
      flushProfile(expect.getState().testPath ?? 'unknown')
      return
    }
    const admin = new Client({ connectionString: baseConnectionUri })
    await admin.connect()
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${uniqueDbName} WITH (FORCE)`)
    } finally {
      await admin.end()
    }
    mark('dropDb')
    flushProfile(expect.getState().testPath ?? 'unknown')
  }, HOOK_TIMEOUT_MS)

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

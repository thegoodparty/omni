import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql'
import { createHash } from 'crypto'
import { sync as glob } from 'fast-glob'
import { readFileSync } from 'fs'

export const TEMPLATE_PREFIX = 'gp_api_tmpl_'

// Serializes globalSetup against every suite's clone. The template itself no
// longer depends on this for correctness — one is published by rename, so a
// half-built template is never visible under its finished name — but
// globalSetup also sweeps superseded templates, and that must not drop one a
// concurrent run is about to clone. globalSetup takes this exclusively; each
// clone takes it in shared mode.
export const TEMPLATE_LOCK_KEY = 847_213_559

// Durability buys nothing here and costs a lot: the per-test reset TRUNCATEs,
// and TRUNCATE's commit has to sync a freshly created relation file per table.
// That measured at ~350-400ms per reset on the defaults versus ~10ms with
// these off — the margin that decides whether a reset survives a contended CI
// runner or trips its hook timeout. The container is thrown away after the
// run, so all that is given up is crash recovery.
const NO_DURABILITY = [
  '-c',
  'fsync=off',
  '-c',
  'synchronous_commit=off',
  '-c',
  'full_page_writes=off',
]

// One container serves every checkout on the machine, so its ceiling has to
// cover concurrent runs rather than one. Postgres defaults to 100 and a single
// four-worker run already draws ~84 at Prisma's default pool size.
const CONNECTION_CEILING = ['-c', 'max_connections=300']

// Caps Prisma's pool per worker, which otherwise sizes itself to
// cores * 2 + 1. A worker issues one query at a time, so a small pool costs
// nothing and keeps concurrent runs clear of the ceiling above.
export const TEST_POOL_LIMIT = 5

// globalSetup and every useTestService suite must build the container with the
// exact same config: testcontainers keys reuse on a hash of that config, so any
// difference would hand a suite a fresh container without the template that
// globalSetup built, and its CREATE DATABASE ... TEMPLATE would fail.
export const startTestPostgres = (): Promise<StartedPostgreSqlContainer> =>
  new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('postgres')
    .withUsername('test_user')
    .withPassword('test_password')
    .withCommand(['postgres', ...NO_DURABILITY, ...CONNECTION_CEILING])
    .withReuse()
    .start()

export const loadMigrationsSql = (): string =>
  glob(`${__dirname}/../prisma/schema/migrations/*/*.sql`)
    // fast-glob does not guarantee order; migrations are timestamp-prefixed and
    // order-dependent (later files ALTER tables the earliest one CREATEs), so
    // sort the paths to replay them chronologically.
    .sort()
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')

let templateName: string | undefined

// Names the template after a digest of what it contains, so every checkout on
// these migrations shares one warm copy while checkouts on any other set get
// their own and cannot interfere. This is what lets the container be shared:
// the old fixed name had to be scoped to a checkout path, because concurrent
// runs raced on dropping and rebuilding it.
//
// Memoized because every suite asks for it, and a miss re-reads every
// migration file.
export const templateDbName = (): string =>
  (templateName ??= `${TEMPLATE_PREFIX}${createHash('sha256')
    .update(loadMigrationsSql())
    .digest('hex')
    .slice(0, 16)}`)

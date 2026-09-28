import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql'
import { createHash } from 'crypto'
import { sync as glob } from 'fast-glob'
import { readFileSync } from 'fs'

export const TEMPLATE_PREFIX = 'election_api_tmpl_'

// Serializes globalSetup's template build against every suite's clone.
// globalSetup takes it exclusively; each clone takes it in shared mode.
//
// Advisory locks are keyed per cluster, not per database, and gp-api and
// election-api now share one when both point at the same external server. So
// this key must differ from gp-api's TEMPLATE_LOCK_KEY (847_213_559) —
// otherwise each package's globalSetup would block on the other's for no
// reason.
export const TEMPLATE_LOCK_KEY = 561_904_233

// globalSetup and every useTestService suite must build the container with the
// exact same config: testcontainers keys reuse on a hash of that config, so any
// difference would hand a suite a fresh container without the template that
// globalSetup built, and its CREATE DATABASE ... TEMPLATE would fail.
export const startTestPostgres = (): Promise<StartedPostgreSqlContainer> =>
  new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('postgres')
    .withUsername('test_user')
    .withPassword('test_password')
    .withReuse()
    .start()

// Caps Prisma's pool per worker, which otherwise sizes itself to
// cores * 2 + 1. A worker issues one query at a time, so a small pool costs
// nothing, and one server now serves every checkout on the machine and both
// packages — an uncapped pool lets concurrent runs exhaust max_connections.
// os.cpus() inside a container often reports the host's core count rather
// than the task's, so the uncapped number is not even bounded by the vCPUs
// the task was given.
export const TEST_POOL_LIMIT = 5

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
// their own and cannot interfere. The old fixed name was dropped and rebuilt
// in place on every run, which two concurrent runs against one server destroy
// for each other mid-test.
//
// Memoized because every suite asks for it, and a miss re-reads every
// migration file.
export const templateDbName = (): string =>
  (templateName ??= `${TEMPLATE_PREFIX}${createHash('sha256')
    .update(loadMigrationsSql())
    .digest('hex')
    .slice(0, 16)}`)

const MAINTENANCE_PATH = '/postgres'

// Derives the URL of one database on the same server. Anchored on purpose:
// an unanchored replace('/postgres', ...) also matches the '//postgres' in
// the userinfo of a URL like postgresql://postgres:pw@127.0.0.1:5432/postgres,
// so against a sidecar running as the image superuser a blind replace rewrites
// the username and every connection fails 28P01 instead.
export const withDatabase = (baseUri: string, database: string): string => {
  if (!baseUri.endsWith(MAINTENANCE_PATH)) {
    throw new Error(
      'The test Postgres URI must end in /postgres — every per-database URL ' +
        'is derived from it by swapping that suffix, and a URI that does ' +
        'not would silently leave the harness on the maintenance database.',
    )
  }
  return `${baseUri.slice(0, -MAINTENANCE_PATH.length)}/${database}`
}

// Declared in both packages' harnesses rather than shared: gp-api and
// election-api are independently deployable and neither imports the other's
// source. The other copy is packages/gp-api/src/test-postgres.ts — keep the
// name identical there.
export const TEST_POSTGRES_URL_VAR = 'OMNI_TEST_POSTGRES_URL'

// DB SAFETY: a testcontainer always binds a random loopback port, so the
// harness could never reach anything else. An operator-supplied URL has to
// prove the same thing, because this harness replays every migration and
// issues CREATE/DROP DATABASE.
export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]']

// Every failure here throws rather than falling back to a container: a silent
// fallback inside a sandbox with no Docker socket surfaces as "Could not find
// a working container runtime", which says nothing about the real mistake.
export const externalTestPostgresUrl = (
  env: NodeJS.ProcessEnv,
): string | null => {
  const raw = env[TEST_POSTGRES_URL_VAR]?.trim()
  if (!raw) return null

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(
      `${TEST_POSTGRES_URL_VAR} is not a parseable URL. Expected ` +
        'something like postgresql://user:pass@127.0.0.1:5432/postgres.',
    )
  }

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error(
      `${TEST_POSTGRES_URL_VAR} must use postgresql:// or postgres:// ` +
        `(got ${url.protocol}//).`,
    )
  }

  if (!LOOPBACK_HOSTS.includes(url.hostname)) {
    throw new Error(
      `${TEST_POSTGRES_URL_VAR} must point at a loopback host (got ` +
        `${url.hostname}). This harness replays migrations and issues ` +
        'CREATE/DROP DATABASE, so it may never be able to reach a dev or ' +
        'prod cluster.',
    )
  }

  if (url.pathname !== '/postgres' || url.search || url.hash) {
    throw new Error(
      `${TEST_POSTGRES_URL_VAR} must end in /postgres with no query ` +
        `string (got "${url.pathname}${url.search}${url.hash}"). ` +
        'test-global-setup.ts and test-service.ts derive every ' +
        'per-database URL by swapping that suffix (see withDatabase), so ' +
        'the maintenance database has to be named postgres.',
    )
  }

  return raw
}

// The one place either caller resolves a server. A sandbox with no Docker
// socket (an ECS Fargate task running a Postgres sidecar on loopback) sets
// TEST_POSTGRES_URL_VAR, and these suites then run against a server the
// harness did not start.
export const testPostgresUri = async (): Promise<string> => {
  const external = externalTestPostgresUrl(process.env)
  if (external) return external
  return (await startTestPostgres()).getConnectionUri()
}

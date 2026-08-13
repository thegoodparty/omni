import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql'
import { sync as glob } from 'fast-glob'
import { readFileSync } from 'fs'

export const TEMPLATE_DB = 'election_api_test_template'

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

export const loadMigrationsSql = (): string =>
  glob(`${__dirname}/../prisma/schema/migrations/*/*.sql`)
    // fast-glob does not guarantee order; migrations are timestamp-prefixed and
    // order-dependent (later files ALTER tables the earliest one CREATEs), so
    // sort the paths to replay them chronologically.
    .sort()
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')

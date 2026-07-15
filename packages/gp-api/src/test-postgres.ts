import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql'
import { sync as glob } from 'fast-glob'
import { readFileSync } from 'fs'

export const TEMPLATE_DB = 'gp_api_test_template'

// Serializes globalSetup's template rebuild against useTestService's
// clone-from-template, since both can run concurrently against the shared
// container (multiple vitest run processes in the same worktree, or a
// stale/racing reuse match). globalSetup takes this exclusively; each suite's
// clone takes it in shared mode, so a rebuild can never land mid-clone.
export const TEMPLATE_LOCK_KEY = 847_213_559

// globalSetup and every useTestService suite must build the container with the
// exact same config: testcontainers keys reuse on a hash of that config, so any
// difference would hand a suite a fresh container without the template that
// globalSetup built, and its CREATE DATABASE ... TEMPLATE would fail.
//
// The checkout label scopes that hash to this worktree's absolute path.
// Without it, every checkout (worktree, clone, CI runner) hashes identically
// and reuses the same physical container, so two `vitest run` processes from
// different worktrees race on globalSetup's DROP DATABASE ... WITH (FORCE) /
// rebuild and stomp each other's fixture data.
export const startTestPostgres = (): Promise<StartedPostgreSqlContainer> =>
  new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('postgres')
    .withUsername('test_user')
    .withPassword('test_password')
    .withLabels({ 'gp-api-test-checkout': __dirname })
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

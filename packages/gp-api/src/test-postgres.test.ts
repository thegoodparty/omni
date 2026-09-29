import { describe, expect, it } from 'vitest'
import {
  TEST_POSTGRES_URL_VAR,
  externalTestPostgresUrl,
  withDatabase,
} from './test-postgres'

const envWith = (value?: string): NodeJS.ProcessEnv =>
  value === undefined ? {} : { [TEST_POSTGRES_URL_VAR]: value }

describe('externalTestPostgresUrl', () => {
  it('returns null when the variable is unset', () => {
    expect(externalTestPostgresUrl(envWith())).toBeNull()
  })

  it('returns null when the variable is blank', () => {
    expect(externalTestPostgresUrl(envWith('   '))).toBeNull()
  })

  it('returns a loopback url unchanged', () => {
    const url = 'postgresql://postgres:pw@127.0.0.1:5432/postgres'
    expect(externalTestPostgresUrl(envWith(url))).toBe(url)
  })

  it('accepts localhost and the postgres:// alias', () => {
    const url = 'postgres://postgres:pw@localhost:5432/postgres'
    expect(externalTestPostgresUrl(envWith(url))).toBe(url)
  })

  it('rejects a non-local host', () => {
    expect(() =>
      externalTestPostgresUrl(
        envWith('postgresql://u:pw@db.prod.internal:5432/postgres'),
      ),
    ).toThrow(new RegExp(`${TEST_POSTGRES_URL_VAR}.+loopback host`, 's'))
  })

  it('rejects a non-postgres protocol', () => {
    expect(() =>
      externalTestPostgresUrl(envWith('http://127.0.0.1:5432/postgres')),
    ).toThrow(new RegExp(`${TEST_POSTGRES_URL_VAR}.+postgresql://`, 's'))
  })

  it('rejects a maintenance database other than postgres', () => {
    expect(() =>
      externalTestPostgresUrl(envWith('postgresql://u:pw@127.0.0.1:5432/app')),
    ).toThrow(new RegExp(`${TEST_POSTGRES_URL_VAR}.+/postgres`, 's'))
  })

  it('rejects a url carrying a query string', () => {
    expect(() =>
      externalTestPostgresUrl(
        envWith('postgresql://u:pw@127.0.0.1:5432/postgres?sslmode=disable'),
      ),
    ).toThrow(new RegExp(`${TEST_POSTGRES_URL_VAR}.+query string`, 's'))
  })

  it('rejects a malformed url', () => {
    expect(() => externalTestPostgresUrl(envWith('not a url'))).toThrow(
      new RegExp(`${TEST_POSTGRES_URL_VAR}.+parseable URL`, 's'),
    )
  })
})

describe('withDatabase', () => {
  it('swaps only the database, not a userinfo that reads the same', () => {
    expect(
      withDatabase('postgresql://postgres:pw@127.0.0.1:5432/postgres', 'a'),
    ).toBe('postgresql://postgres:pw@127.0.0.1:5432/a')
  })

  it('swaps the database on a testcontainer uri', () => {
    expect(
      withDatabase('postgresql://test_user:pw@localhost:49153/postgres', 'a'),
    ).toBe('postgresql://test_user:pw@localhost:49153/a')
  })

  it('throws rather than silently leaving the maintenance database', () => {
    expect(() =>
      withDatabase('postgresql://u:pw@127.0.0.1:5432/other', 'a'),
    ).toThrow(/must end in \/postgres/)
  })
})

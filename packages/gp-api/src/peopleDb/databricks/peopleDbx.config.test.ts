import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  resolvePeopleDbxConfig,
  useDatabricksPeopleDb,
} from './peopleDbx.config'

const DATABRICKS_ENV_KEYS = [
  'USE_DATABRICKS_PEOPLE_DB',
  'PEOPLE_DATABRICKS_SERVER_HOSTNAME',
  'PEOPLE_DATABRICKS_HTTP_PATH',
  'PEOPLE_DATABRICKS_CLIENT_ID',
  'PEOPLE_DATABRICKS_CLIENT_SECRET',
  'PEOPLE_DATABRICKS_API_KEY',
  'DATABRICKS_SERVER_HOSTNAME',
  'DATABRICKS_HTTP_PATH',
  'DATABRICKS_CLIENT_ID',
  'DATABRICKS_CLIENT_SECRET',
  'DATABRICKS_API_KEY',
] as const

const configureCredential = (): void => {
  process.env.PEOPLE_DATABRICKS_SERVER_HOSTNAME = 'dbc-1.cloud.databricks.com'
  process.env.PEOPLE_DATABRICKS_HTTP_PATH = '/sql/1.0/warehouses/wh-people'
  process.env.PEOPLE_DATABRICKS_CLIENT_ID = 'client'
  process.env.PEOPLE_DATABRICKS_CLIENT_SECRET = 'secret'
}

describe('peopleDbx config', () => {
  const original = new Map<string, string | undefined>()

  beforeEach(() => {
    for (const key of DATABRICKS_ENV_KEYS) {
      original.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  describe('useDatabricksPeopleDb', () => {
    it('is off unless the flag is exactly true', () => {
      configureCredential()

      expect(useDatabricksPeopleDb()).toBe(false)
      process.env.USE_DATABRICKS_PEOPLE_DB = 'false'
      expect(useDatabricksPeopleDb()).toBe(false)
      process.env.USE_DATABRICKS_PEOPLE_DB = '1'
      expect(useDatabricksPeopleDb()).toBe(false)
    })

    it('is on when the flag is true and the credential resolves', () => {
      configureCredential()
      process.env.USE_DATABRICKS_PEOPLE_DB = 'true'

      expect(useDatabricksPeopleDb()).toBe(true)
    })

    // The flag can ship ahead of the service principal, so "on but
    // unconfigured" has to keep serving from Postgres instead of failing every
    // voter request.
    it('falls back to Postgres when the flag is on but unconfigured', () => {
      process.env.USE_DATABRICKS_PEOPLE_DB = 'true'

      expect(useDatabricksPeopleDb()).toBe(false)
    })

    it('does not fall back to the Serve or Campaign Manager credential', () => {
      process.env.USE_DATABRICKS_PEOPLE_DB = 'true'
      process.env.DATABRICKS_SERVER_HOSTNAME = 'dbc-1.cloud.databricks.com'
      process.env.DATABRICKS_HTTP_PATH = '/sql/1.0/warehouses/wh-serve'
      process.env.DATABRICKS_CLIENT_ID = 'serve-client'
      process.env.DATABRICKS_CLIENT_SECRET = 'serve-secret'

      expect(useDatabricksPeopleDb()).toBe(false)
    })
  })

  describe('resolvePeopleDbxConfig', () => {
    // The warehouse is dedicated, so it can only come from this prefix's own
    // http path — there is no default to fall back to.
    it('takes the warehouse from its own http path', () => {
      configureCredential()

      expect(resolvePeopleDbxConfig()).toEqual({
        hostname: 'dbc-1.cloud.databricks.com',
        warehouseId: 'wh-people',
        accessToken: undefined,
        oauthClientId: 'client',
        oauthClientSecret: 'secret',
      })
    })

    it('accepts a PAT for local development', () => {
      process.env.PEOPLE_DATABRICKS_SERVER_HOSTNAME =
        'dbc-1.cloud.databricks.com'
      process.env.PEOPLE_DATABRICKS_HTTP_PATH = '/sql/1.0/warehouses/wh-people'
      process.env.PEOPLE_DATABRICKS_API_KEY = 'pat'

      expect(resolvePeopleDbxConfig()?.accessToken).toBe('pat')
    })

    it('is null when no credential is configured', () => {
      process.env.PEOPLE_DATABRICKS_SERVER_HOSTNAME =
        'dbc-1.cloud.databricks.com'
      process.env.PEOPLE_DATABRICKS_HTTP_PATH = '/sql/1.0/warehouses/wh-people'

      expect(resolvePeopleDbxConfig()).toBeNull()
    })

    it('is null when the http path names no warehouse', () => {
      process.env.PEOPLE_DATABRICKS_SERVER_HOSTNAME =
        'dbc-1.cloud.databricks.com'
      process.env.PEOPLE_DATABRICKS_HTTP_PATH = '/sql/protocolv1/o/0/1234-abcd'
      process.env.PEOPLE_DATABRICKS_API_KEY = 'pat'

      expect(resolvePeopleDbxConfig()).toBeNull()
    })

    it('ignores the Serve credential entirely', () => {
      process.env.DATABRICKS_SERVER_HOSTNAME = 'dbc-1.cloud.databricks.com'
      process.env.DATABRICKS_HTTP_PATH = '/sql/1.0/warehouses/wh-serve'
      process.env.DATABRICKS_API_KEY = 'serve-pat'

      expect(resolvePeopleDbxConfig()).toBeNull()
    })
  })
})

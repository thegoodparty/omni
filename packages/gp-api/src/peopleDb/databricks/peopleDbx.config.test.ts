import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PEOPLE_DBX_HOSTNAME, resolvePeopleDbxConfig } from './peopleDbx.config'

const DATABRICKS_ENV_KEYS = [
  'PEOPLE_DATABRICKS_WAREHOUSE_ID',
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
  process.env.PEOPLE_DATABRICKS_WAREHOUSE_ID = 'wh-people'
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

  describe('resolvePeopleDbxConfig', () => {
    it('takes the warehouse from env and the hostname from the constant', () => {
      configureCredential()

      expect(resolvePeopleDbxConfig()).toEqual({
        hostname: PEOPLE_DBX_HOSTNAME,
        warehouseId: 'wh-people',
        accessToken: undefined,
        oauthClientId: 'client',
        oauthClientSecret: 'secret',
      })
    })

    it('accepts a PAT for local development', () => {
      process.env.PEOPLE_DATABRICKS_WAREHOUSE_ID = 'wh-people'
      process.env.PEOPLE_DATABRICKS_API_KEY = 'pat'

      expect(resolvePeopleDbxConfig()?.accessToken).toBe('pat')
    })

    // A leftover personal token must not outrank the service principal.
    it('prefers the service principal over a lingering PAT', () => {
      configureCredential()
      process.env.PEOPLE_DATABRICKS_API_KEY = 'stale-pat'

      const config = resolvePeopleDbxConfig()
      expect(config?.oauthClientId).toBe('client')
      expect(config?.oauthClientSecret).toBe('secret')
      // The assertion that matters: the client short-circuits on any token it
      // is handed, so precedence only holds if the PAT is absent entirely.
      expect(config?.accessToken).toBeUndefined()
    })

    it('is null when no credential is configured', () => {
      process.env.PEOPLE_DATABRICKS_WAREHOUSE_ID = 'wh-people'

      expect(resolvePeopleDbxConfig()).toBeNull()
    })

    it('is null when no warehouse is configured', () => {
      process.env.PEOPLE_DATABRICKS_CLIENT_ID = 'client'
      process.env.PEOPLE_DATABRICKS_CLIENT_SECRET = 'secret'

      expect(resolvePeopleDbxConfig()).toBeNull()
    })

    // An http path pasted in where the bare id belongs would otherwise be sent
    // to the API as a warehouse id and fail as an opaque 400.
    it('rejects a warehouse id that is actually a path', () => {
      process.env.PEOPLE_DATABRICKS_WAREHOUSE_ID =
        '/sql/1.0/warehouses/wh-people'
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

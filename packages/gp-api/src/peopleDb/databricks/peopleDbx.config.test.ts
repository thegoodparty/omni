import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  resolvePeopleDbxConfig,
  useDatabricksPeopleDb,
} from './peopleDbx.config'

const DATABRICKS_ENV_KEYS = [
  'USE_DATABRICKS_PEOPLE_DB',
  'DATABRICKS_SERVER_HOSTNAME',
  'DATABRICKS_HTTP_PATH',
  'DATABRICKS_CLIENT_ID',
  'DATABRICKS_CLIENT_SECRET',
  'DATABRICKS_API_KEY',
  'PEOPLE_DB_DATABRICKS_WAREHOUSE_ID',
] as const

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
      expect(useDatabricksPeopleDb()).toBe(false)
      process.env.USE_DATABRICKS_PEOPLE_DB = 'false'
      expect(useDatabricksPeopleDb()).toBe(false)
      process.env.USE_DATABRICKS_PEOPLE_DB = '1'
      expect(useDatabricksPeopleDb()).toBe(false)
    })

    it('is on when the flag is true', () => {
      process.env.USE_DATABRICKS_PEOPLE_DB = 'true'

      expect(useDatabricksPeopleDb()).toBe(true)
    })
  })

  describe('resolvePeopleDbxConfig', () => {
    it('takes the warehouse from the http path', () => {
      process.env.DATABRICKS_SERVER_HOSTNAME = 'dbc-1.cloud.databricks.com'
      process.env.DATABRICKS_HTTP_PATH = '/sql/1.0/warehouses/18583d8b081c6486'
      process.env.DATABRICKS_API_KEY = 'pat'

      expect(resolvePeopleDbxConfig()).toEqual({
        hostname: 'dbc-1.cloud.databricks.com',
        warehouseId: '18583d8b081c6486',
        accessToken: 'pat',
        oauthClientId: undefined,
        oauthClientSecret: undefined,
      })
    })

    it('lets voter scans point at their own warehouse', () => {
      process.env.DATABRICKS_SERVER_HOSTNAME = 'dbc-1.cloud.databricks.com'
      process.env.DATABRICKS_HTTP_PATH = '/sql/1.0/warehouses/18583d8b081c6486'
      process.env.DATABRICKS_API_KEY = 'pat'
      process.env.PEOPLE_DB_DATABRICKS_WAREHOUSE_ID = 'aaaabbbbccccdddd'

      expect(resolvePeopleDbxConfig()?.warehouseId).toBe('aaaabbbbccccdddd')
    })

    it('prefers OAuth M2M credentials when both are present', () => {
      process.env.DATABRICKS_SERVER_HOSTNAME = 'dbc-1.cloud.databricks.com'
      process.env.DATABRICKS_HTTP_PATH = '/sql/1.0/warehouses/18583d8b081c6486'
      process.env.DATABRICKS_CLIENT_ID = 'client'
      process.env.DATABRICKS_CLIENT_SECRET = 'secret'

      const config = resolvePeopleDbxConfig()

      expect(config?.oauthClientId).toBe('client')
      expect(config?.oauthClientSecret).toBe('secret')
    })

    it('is null when no credential is configured', () => {
      process.env.DATABRICKS_SERVER_HOSTNAME = 'dbc-1.cloud.databricks.com'
      process.env.DATABRICKS_HTTP_PATH = '/sql/1.0/warehouses/18583d8b081c6486'

      expect(resolvePeopleDbxConfig()).toBeNull()
    })

    it('is null when the http path names no warehouse', () => {
      process.env.DATABRICKS_SERVER_HOSTNAME = 'dbc-1.cloud.databricks.com'
      process.env.DATABRICKS_HTTP_PATH = '/sql/protocolv1/o/0/1234-abcd'
      process.env.DATABRICKS_API_KEY = 'pat'

      expect(resolvePeopleDbxConfig()).toBeNull()
    })
  })
})

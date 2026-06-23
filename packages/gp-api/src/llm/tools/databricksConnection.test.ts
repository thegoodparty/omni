import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveDatabricksConnection } from './databricksConnection'

const KEYS = [
  'DATABRICKS_SERVER_HOSTNAME',
  'DATABRICKS_HTTP_PATH',
  'DATABRICKS_CLIENT_ID',
  'DATABRICKS_CLIENT_SECRET',
  'DATABRICKS_API_KEY',
] as const

const saved: Record<string, string | undefined> = {}

// Snapshot + clear the relevant vars so each test is hermetic regardless of the
// ambient env (.env.test may or may not set them), then restore afterwards.
beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('resolveDatabricksConnection', () => {
  it('resolves a PAT when only DATABRICKS_API_KEY is set', () => {
    process.env.DATABRICKS_SERVER_HOSTNAME = 'host.cloud.databricks.com'
    process.env.DATABRICKS_HTTP_PATH = '/sql/1.0/warehouses/abc'
    process.env.DATABRICKS_API_KEY = 'dapi-token'

    expect(resolveDatabricksConnection()).toEqual({
      hostname: 'host.cloud.databricks.com',
      httpPath: '/sql/1.0/warehouses/abc',
      accessToken: 'dapi-token',
      oauthClientId: undefined,
      oauthClientSecret: undefined,
    })
  })

  it('resolves OAuth M2M creds when client id + secret are set', () => {
    process.env.DATABRICKS_SERVER_HOSTNAME = 'host.cloud.databricks.com'
    process.env.DATABRICKS_HTTP_PATH = '/sql/1.0/warehouses/abc'
    process.env.DATABRICKS_CLIENT_ID = 'client-id'
    process.env.DATABRICKS_CLIENT_SECRET = 'client-secret'

    expect(resolveDatabricksConnection()).toEqual({
      hostname: 'host.cloud.databricks.com',
      httpPath: '/sql/1.0/warehouses/abc',
      accessToken: undefined,
      oauthClientId: 'client-id',
      oauthClientSecret: 'client-secret',
    })
  })

  it('returns both credentials when OAuth and a PAT are present', () => {
    process.env.DATABRICKS_SERVER_HOSTNAME = 'host.cloud.databricks.com'
    process.env.DATABRICKS_HTTP_PATH = '/sql/1.0/warehouses/abc'
    process.env.DATABRICKS_CLIENT_ID = 'client-id'
    process.env.DATABRICKS_CLIENT_SECRET = 'client-secret'
    process.env.DATABRICKS_API_KEY = 'dapi-token'

    expect(resolveDatabricksConnection()).toMatchObject({
      oauthClientId: 'client-id',
      oauthClientSecret: 'client-secret',
      accessToken: 'dapi-token',
    })
  })

  it('returns null on partial OAuth (client id, no secret) with no PAT', () => {
    process.env.DATABRICKS_SERVER_HOSTNAME = 'host.cloud.databricks.com'
    process.env.DATABRICKS_HTTP_PATH = '/sql/1.0/warehouses/abc'
    process.env.DATABRICKS_CLIENT_ID = 'client-id'

    expect(resolveDatabricksConnection()).toBeNull()
  })

  it('returns null when hostname is missing', () => {
    process.env.DATABRICKS_HTTP_PATH = '/sql/1.0/warehouses/abc'
    process.env.DATABRICKS_API_KEY = 'dapi-token'

    expect(resolveDatabricksConnection()).toBeNull()
  })

  it('returns null when httpPath is missing', () => {
    process.env.DATABRICKS_SERVER_HOSTNAME = 'host.cloud.databricks.com'
    process.env.DATABRICKS_API_KEY = 'dapi-token'

    expect(resolveDatabricksConnection()).toBeNull()
  })

  it('returns null when no credential is configured', () => {
    process.env.DATABRICKS_SERVER_HOSTNAME = 'host.cloud.databricks.com'
    process.env.DATABRICKS_HTTP_PATH = '/sql/1.0/warehouses/abc'

    expect(resolveDatabricksConnection()).toBeNull()
  })
})

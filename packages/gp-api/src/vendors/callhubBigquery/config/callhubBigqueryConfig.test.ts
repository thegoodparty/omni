import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  readBigqueryClientOptions,
  readBigqueryCredentials,
  readBigqueryDataset,
  readBigqueryProjectId,
} from './callhubBigqueryConfig'

const ENV_KEYS = [
  'CALLHUB_BQ_PROJECT_ID',
  'CALLHUB_BQ_DATASET',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'CALLHUB_BQ_SA_KEY_JSON',
] as const

const SA_KEY = JSON.stringify({
  type: 'service_account',
  client_email: 'reader@callhub-project.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
  private_key_id: 'should-be-stripped',
})

describe('callhubBigqueryConfig', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = saved[key]
      }
    }
  })

  it('asserts CALLHUB_BQ_PROJECT_ID at use', () => {
    expect(() => readBigqueryProjectId()).toThrow(/CALLHUB_BQ_PROJECT_ID/)
    process.env.CALLHUB_BQ_PROJECT_ID = 'callhub-project'
    expect(readBigqueryProjectId()).toBe('callhub-project')
  })

  it('asserts CALLHUB_BQ_DATASET at use', () => {
    expect(() => readBigqueryDataset()).toThrow(/CALLHUB_BQ_DATASET/)
    process.env.CALLHUB_BQ_DATASET = 'voice_results'
    expect(readBigqueryDataset()).toBe('voice_results')
  })

  it('prefers ADC (keyFilename) when both credential envs are set', () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/secrets/key.json'
    process.env.CALLHUB_BQ_SA_KEY_JSON = SA_KEY
    expect(readBigqueryCredentials()).toEqual({
      keyFilename: '/secrets/key.json',
    })
  })

  it('parses the inline key and strips fields BigQuery does not need', () => {
    process.env.CALLHUB_BQ_SA_KEY_JSON = SA_KEY
    expect(readBigqueryCredentials()).toEqual({
      credentials: {
        client_email: 'reader@callhub-project.iam.gserviceaccount.com',
        private_key:
          '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
      },
    })
  })

  it('returns ambient-ADC (empty) options when no credential env is set', () => {
    expect(readBigqueryCredentials()).toEqual({})
  })

  it('merges project id and credentials into client options', () => {
    process.env.CALLHUB_BQ_PROJECT_ID = 'callhub-project'
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/secrets/key.json'
    expect(readBigqueryClientOptions()).toEqual({
      projectId: 'callhub-project',
      keyFilename: '/secrets/key.json',
    })
  })
})

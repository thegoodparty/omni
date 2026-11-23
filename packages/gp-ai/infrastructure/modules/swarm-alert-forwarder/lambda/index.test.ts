import { createHmac } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }))

vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = sendMock
  },
  GetSecretValueCommand: class {
    constructor(public readonly input: { SecretId: string }) {}
  },
}))

import {
  buildPayload,
  decodeSigningSecret,
  deliver,
  parseMessage,
  type SnsRecord,
  type SwarmAlertConfig,
} from './index'

const SIGNING_KEY_BASE64 = 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
const signingKey = Buffer.from(SIGNING_KEY_BASE64, 'base64')

const record = (overrides: Partial<SnsRecord['Sns']> = {}): SnsRecord => ({
  Sns: {
    TopicArn:
      'arn:aws:sns:us-west-2:333022194791:serve-analyze-pipeline-failures-dev',
    Message: '{"alarm":"Pipeline failed","exitCode":1}',
    ...overrides,
  },
})

describe('decodeSigningSecret', () => {
  it('decodes a base64 secret and strips the whsec_ prefix', () => {
    expect(decodeSigningSecret(SIGNING_KEY_BASE64)).toEqual(signingKey)
    expect(decodeSigningSecret(`whsec_${SIGNING_KEY_BASE64}`)).toEqual(
      signingKey
    )
  })

  it('refuses anything that is not non-empty base64', () => {
    expect(decodeSigningSecret('')).toBeNull()
    expect(decodeSigningSecret('whsec_')).toBeNull()
    expect(decodeSigningSecret('not base64!')).toBeNull()
    expect(decodeSigningSecret('abcde')).toBeNull()
  })
})

describe('parseMessage', () => {
  it('parses the JSON an input transformer emits', () => {
    expect(parseMessage('{"alarm":"Pipeline failed"}')).toEqual({
      alarm: 'Pipeline failed',
    })
  })

  it('keeps a plain-text message as a string', () => {
    expect(parseMessage('Pipeline failed after 3 retries')).toBe(
      'Pipeline failed after 3 retries'
    )
  })
})

describe('buildPayload', () => {
  beforeEach(() => {
    vi.stubEnv('ENVIRONMENT', 'dev')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('names the topic, parses the message, and stamps the environment', () => {
    expect(buildPayload(record())).toEqual({
      topic: 'serve-analyze-pipeline-failures-dev',
      subject: null,
      message: { alarm: 'Pipeline failed', exitCode: 1 },
      environment: 'dev',
    })
  })

  it('carries an SNS subject through when one is set', () => {
    expect(buildPayload(record({ Subject: 'Pipeline failed' })).subject).toBe(
      'Pipeline failed'
    )
  })
})

describe('deliver', () => {
  const config: SwarmAlertConfig = {
    url: 'https://delegate-swarm.infra.goodparty.org/api/workflows/abc/trigger',
    signingKey,
  }

  const payload = {
    topic: 'serve-analyze-pipeline-failures-dev',
    subject: null,
    message: { alarm: 'Pipeline failed' },
    environment: 'dev',
  }

  const fetchCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.map(([, init]) => ({
      body: init.body as string,
      headers: init.headers as Record<string, string>,
    }))

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the payload with standard-webhooks headers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 202 }))
    vi.stubGlobal('fetch', fetchMock)

    await deliver(config, payload)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(config.url)
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify(payload))

    const headers = init.headers as Record<string, string>
    expect(headers['content-type']).toBe('application/json')
    expect(headers['webhook-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
    expect(headers['webhook-timestamp']).toMatch(/^\d+$/)
  })

  it('signs id, timestamp and body the way the receiver recomputes them', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await deliver(config, payload)

    const [{ body, headers }] = fetchCalls(fetchMock)
    const expected = `v1,${createHmac('sha256', signingKey)
      .update(`${headers['webhook-id']}.${headers['webhook-timestamp']}.${body}`)
      .digest('base64')}`

    expect(headers['webhook-signature']).toBe(expected)
  })

  it('uses a fresh webhook-id per delivery', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await deliver(config, payload)
    await deliver(config, payload)

    const ids = fetchCalls(fetchMock).map((call) => call.headers['webhook-id'])
    expect(ids[0]).not.toBe(ids[1])
  })

  it('throws on a non-2xx response so SNS retries', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('invalid signature', { status: 401 }))
    )

    await expect(deliver(config, payload)).rejects.toThrow(/401/)
  })
})

describe('handler', () => {
  const secretsWith = (values: Record<string, unknown>) => ({
    SecretString: JSON.stringify(values),
  })

  const readySecrets = () =>
    secretsWith({
      SWARM_ALERT_WEBHOOK_URL: 'https://swarm.example/hook',
      SWARM_ALERT_WEBHOOK_SECRET: `whsec_${SIGNING_KEY_BASE64}`,
    })

  // The config cache lives in module scope, so each case needs its own module
  // instance rather than a cache left warm by the one before it.
  const loadHandler = async () => {
    vi.resetModules()
    return (await import('./index')).handler
  }

  const stubFetch = (status = 200) => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () => new Response('', { status }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  beforeEach(() => {
    vi.stubEnv('ENVIRONMENT', 'dev')
    vi.stubEnv('SECRET_NAME', 'AI_SECRETS_DEV')
    sendMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('forwards every record in the event', async () => {
    sendMock.mockResolvedValue(readySecrets())
    const fetchMock = stubFetch()
    const handler = await loadHandler()

    await handler({
      Records: [record(), record({ Subject: 'Pipeline failed' })],
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('fails when the secret lacks the webhook URL', async () => {
    sendMock.mockResolvedValue(
      secretsWith({
        SWARM_ALERT_WEBHOOK_SECRET: `whsec_${SIGNING_KEY_BASE64}`,
      })
    )
    stubFetch()
    const handler = await loadHandler()

    await expect(handler({ Records: [record()] })).rejects.toThrow(
      /SWARM_ALERT_WEBHOOK_URL/
    )
  })

  it('fails when the webhook secret is not base64', async () => {
    sendMock.mockResolvedValue(
      secretsWith({
        SWARM_ALERT_WEBHOOK_URL: 'https://swarm.example/hook',
        SWARM_ALERT_WEBHOOK_SECRET: 'not base64!',
      })
    )
    stubFetch()
    const handler = await loadHandler()

    await expect(handler({ Records: [record()] })).rejects.toThrow(
      /must be base64/
    )
  })

  it('re-reads the secret after a failed delivery instead of caching it', async () => {
    sendMock.mockResolvedValue(readySecrets())
    stubFetch(500)
    const handler = await loadHandler()

    await expect(handler({ Records: [record()] })).rejects.toThrow(/500/)

    stubFetch()
    await handler({ Records: [record()] })

    expect(sendMock).toHaveBeenCalledTimes(2)
  })

  it('caches the secret across warm deliveries', async () => {
    sendMock.mockResolvedValue(readySecrets())
    stubFetch()
    const handler = await loadHandler()

    await handler({ Records: [record()] })
    await handler({ Records: [record()] })

    expect(sendMock).toHaveBeenCalledTimes(1)
  })
})

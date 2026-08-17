import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SmsService } from './sms.service'

const CONFIGURED_ENV = {
  SINCH_PROJECT_ID: 'proj_1',
  SINCH_KEY_ID: 'key_id',
  SINCH_KEY_SECRET: 'key_secret',
  SINCH_APP_ID: 'app_1',
  SINCH_FROM_NUMBER: '+15550001111',
  SINCH_REGION: 'us',
  SINCH_HTTP_TIMEOUT_MS: '15000',
}

const makeToken = () => ({
  getToken: vi.fn().mockResolvedValue('tok_1'),
  invalidate: vi.fn(),
})

/** SinchConfig reads env when constructed, so stub it before instantiating. */
function makeService(env: Record<string, string> = CONFIGURED_ENV) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  const token = makeToken()
  const logger = {
    setContext: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
  const service = new SmsService(token as never, logger as never)
  return { service, token, logger }
}

const accepted = (messageId = 'msg_1') =>
  ({
    ok: true,
    json: () => Promise.resolve({ message_id: messageId }),
  }) as never

const rejected = (status: number, text = 'nope') =>
  ({ ok: false, status, text: () => Promise.resolve(text) }) as never

type SentBody = {
  app_id: string
  recipient: {
    identified_by: {
      channel_identities: { channel: string; identity: string }[]
    }
  }
  message: { text_message: { text: string } }
  channel_priority_order: string[]
  channel_properties: Record<string, string>
}

const sentBody = (fetchMock: ReturnType<typeof vi.fn>, call = 0): SentBody => {
  const [, init] = fetchMock.mock.calls[call] as [string, RequestInit]
  return JSON.parse(String(init.body)) as SentBody
}

describe('SmsService.sendSms', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('posts a Conversation API SMS message and returns the message id', async () => {
    fetchMock.mockResolvedValue(accepted('msg_abc'))
    const { service } = makeService()

    await expect(
      service.sendSms({ to: '5551234567', body: 'hello' }),
    ).resolves.toEqual({ sent: true, messageId: 'msg_abc' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://us.conversation.api.sinch.com/v1/projects/proj_1/messages:send',
    )
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok_1',
    )

    const body = sentBody(fetchMock)
    expect(body.app_id).toBe('app_1')
    // DISPATCH mode addresses the recipient by channel identity, and the number
    // must have been normalized to E.164 first.
    expect(body.recipient.identified_by.channel_identities).toEqual([
      { channel: 'SMS', identity: '+15551234567' },
    ])
    expect(body.message.text_message.text).toBe('hello')
    expect(body.channel_priority_order).toEqual(['SMS'])
    expect(body.channel_properties.SMS_SENDER).toBe('+15550001111')
    // Caps the send at one segment at the provider, not just in our own tests.
    expect(body.channel_properties.SMS_MAX_NUMBER_OF_MESSAGE_PARTS).toBe('1')
  })

  it('reports success without a message id when the response omits one', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as never)
    const { service } = makeService()

    await expect(
      service.sendSms({ to: '5551234567', body: 'hello' }),
    ).resolves.toEqual({ sent: true, messageId: null })
  })

  it('refuses to send when Sinch is not configured', async () => {
    const { service } = makeService({ SINCH_REGION: 'us' })

    const result = await service.sendSms({ to: '5551234567', body: 'hello' })

    expect(result).toEqual({
      sent: false,
      error: expect.stringContaining('SINCH_PROJECT_ID') as string,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an unparseable phone number before calling Sinch', async () => {
    const { service } = makeService()

    const result = await service.sendSms({ to: 'not-a-number', body: 'hello' })

    expect(result.sent).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('redirects to SMS_INTERCEPT_PHONE instead of the real recipient', async () => {
    fetchMock.mockResolvedValue(accepted())
    const { service } = makeService({
      ...CONFIGURED_ENV,
      SMS_INTERCEPT_PHONE: '+15559998888',
    })

    await service.sendSms({ to: '5551234567', body: 'hello' })

    expect(
      sentBody(fetchMock).recipient.identified_by.channel_identities[0]!
        .identity,
    ).toBe('+15559998888')
  })

  it('ignores an empty SMS_INTERCEPT_PHONE rather than sending to nobody', async () => {
    // .env.example ships the key with an empty value, and `'' ?? normalized`
    // would otherwise resolve to the empty string and drop the real recipient.
    fetchMock.mockResolvedValue(accepted())
    const { service } = makeService({
      ...CONFIGURED_ENV,
      SMS_INTERCEPT_PHONE: '',
    })

    await service.sendSms({ to: '5551234567', body: 'hello' })

    expect(
      sentBody(fetchMock).recipient.identified_by.channel_identities[0]!
        .identity,
    ).toBe('+15551234567')
  })

  it('mints a fresh token and retries once when Sinch answers 401', async () => {
    fetchMock
      .mockResolvedValueOnce(rejected(401, 'expired token'))
      .mockResolvedValueOnce(accepted('msg_after_retry'))
    const { service, token } = makeService()

    await expect(
      service.sendSms({ to: '5551234567', body: 'hello' }),
    ).resolves.toEqual({ sent: true, messageId: 'msg_after_retry' })

    expect(token.invalidate).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after a second 401 rather than looping on a bad access key', async () => {
    fetchMock.mockResolvedValue(rejected(401, 'invalid_client'))
    const { service, token } = makeService()

    const result = await service.sendSms({ to: '5551234567', body: 'hello' })

    expect(result.sent).toBe(false)
    expect(token.invalidate).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a 4xx that a resend cannot fix', async () => {
    fetchMock.mockResolvedValue(rejected(400, 'bad sender'))
    const { service } = makeService()

    const result = await service.sendSms({ to: '5551234567', body: 'hello' })

    expect(result).toEqual({
      sent: false,
      error: expect.stringContaining('400') as string,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a 429 and succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(rejected(429, 'slow down'))
      .mockResolvedValueOnce(accepted('msg_2'))
    const { service } = makeService()

    await expect(
      service.sendSms({ to: '5551234567', body: 'hello' }),
    ).resolves.toEqual({ sent: true, messageId: 'msg_2' })
  })

  it('never throws when Sinch is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'))
    const { service } = makeService()

    const result = await service.sendSms({ to: '5551234567', body: 'hello' })

    expect(result).toEqual({
      sent: false,
      error: expect.stringContaining('socket hang up') as string,
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SinchController } from './sinch.controller'
import {
  SINCH_NONCE_HEADER,
  SINCH_SIGNATURE_HEADER,
  SINCH_TIMESTAMP_HEADER,
} from './util/sinchSignature.util'

const SECRET = 'test_webhook_secret'
const NONCE = 'nonce-1'
const TIMESTAMP = '1786392510'
const LEAD_PHONE = '+15551234567'
const APP_ID = '01EB37HMH1M6SV18ABNS3G135H'

/** SinchConfig reads env when constructed, so stub it before instantiating. */
function makeController(secret: string | null = SECRET) {
  vi.stubEnv('SINCH_WEBHOOK_SECRET', secret ?? '')
  const optOut = { setOptedOut: vi.fn().mockResolvedValue(undefined) }
  const logger = {
    setContext: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }
  const controller = new SinchController(optOut as never, logger as never)
  return { controller, optOut }
}

const inboundPayload = (text: string, identity = LEAD_PHONE) => ({
  app_id: APP_ID,
  project_id: 'c36f3d3d-1523-4edd-ae42-11995557ff61',
  message: {
    id: '01EQ8235TD19N21XQTH12B145D',
    direction: 'TO_APP',
    contact_message: { text_message: { text } },
    channel_identity: {
      channel: 'SMS',
      identity,
      app_id: APP_ID,
    },
    accept_time: '2026-08-11T08:17:43.915829Z',
    sender_id: '15550001111',
    processing_mode: 'DISPATCH',
  },
})

/** Builds the request and headers a correctly signed callback would arrive with. */
const signedRequest = (payload: unknown, secret = SECRET) => {
  const rawBody = JSON.stringify(payload)
  const signature = createHmac('sha256', secret)
    .update(`${rawBody}.${NONCE}.${TIMESTAMP}`)
    .digest('base64')
  return {
    req: { rawBody: Buffer.from(rawBody, 'utf8') } as never,
    headers: {
      [SINCH_SIGNATURE_HEADER]: signature,
      [SINCH_NONCE_HEADER]: NONCE,
      [SINCH_TIMESTAMP_HEADER]: TIMESTAMP,
    },
  }
}

describe('SinchController.handleInbound', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('records an opt-out from a nested MESSAGE_INBOUND STOP', async () => {
    const { controller, optOut } = makeController()
    const { req, headers } = signedRequest(inboundPayload('STOP'))

    await expect(controller.handleInbound(req, headers)).resolves.toEqual({
      ok: true,
    })

    // The sender lives in channel_identity.identity, not a top-level `from`.
    expect(optOut.setOptedOut).toHaveBeenCalledWith(LEAD_PHONE, true)
  })

  it('clears an opt-out on START', async () => {
    const { controller, optOut } = makeController()
    const { req, headers } = signedRequest(inboundPayload('START'))

    await controller.handleInbound(req, headers)

    expect(optOut.setOptedOut).toHaveBeenCalledWith(LEAD_PHONE, false)
  })

  it('ignores a message with no opt-out keyword', async () => {
    const { controller, optOut } = makeController()
    const { req, headers } = signedRequest(inboundPayload('thanks!'))

    await expect(controller.handleInbound(req, headers)).resolves.toEqual({
      ok: true,
    })
    expect(optOut.setOptedOut).not.toHaveBeenCalled()
  })

  it('ignores a redacted Smart Conversations payload', async () => {
    // The redaction trigger nests under `message_redaction`; acting on it would
    // mean acting twice on the same inbound message.
    const { controller, optOut } = makeController()
    const { message } = inboundPayload('STOP')
    const { req, headers } = signedRequest({ message_redaction: message })

    await expect(controller.handleInbound(req, headers)).resolves.toEqual({
      ok: true,
    })
    expect(optOut.setOptedOut).not.toHaveBeenCalled()
  })

  it('ignores a callback from a channel other than SMS', async () => {
    const { controller, optOut } = makeController()
    const payload = inboundPayload('STOP')
    payload.message.channel_identity.channel = 'MESSENGER'
    const { req, headers } = signedRequest(payload)

    await controller.handleInbound(req, headers)

    expect(optOut.setOptedOut).not.toHaveBeenCalled()
  })

  it('ignores a delivery receipt or other non-message callback', async () => {
    const { controller, optOut } = makeController()
    const { req, headers } = signedRequest({
      app_id: 'app_1',
      message_delivery_report: { status: 'DELIVERED' },
    })

    await expect(controller.handleInbound(req, headers)).resolves.toEqual({
      ok: true,
    })
    expect(optOut.setOptedOut).not.toHaveBeenCalled()
  })

  it('rejects a callback whose signature does not match', async () => {
    const { controller, optOut } = makeController()
    const { req, headers } = signedRequest(
      inboundPayload('STOP'),
      'wrong_secret',
    )

    await expect(controller.handleInbound(req, headers)).rejects.toThrow(
      'Invalid signature',
    )
    expect(optOut.setOptedOut).not.toHaveBeenCalled()
  })

  it('fails closed when no webhook secret is configured', async () => {
    // An unsigned callback we cannot verify could be forged to suppress a lead's
    // texts, so the endpoint refuses rather than trusting it.
    const { controller, optOut } = makeController(null)
    const { req, headers } = signedRequest(inboundPayload('STOP'))

    await expect(controller.handleInbound(req, headers)).rejects.toThrow(
      'not configured',
    )
    expect(optOut.setOptedOut).not.toHaveBeenCalled()
  })

  it('accepts but ignores a body that is not valid JSON', async () => {
    const { controller, optOut } = makeController()
    const rawBody = 'not json'
    const signature = createHmac('sha256', SECRET)
      .update(`${rawBody}.${NONCE}.${TIMESTAMP}`)
      .digest('base64')

    await expect(
      controller.handleInbound({ rawBody: Buffer.from(rawBody) } as never, {
        [SINCH_SIGNATURE_HEADER]: signature,
        [SINCH_NONCE_HEADER]: NONCE,
        [SINCH_TIMESTAMP_HEADER]: TIMESTAMP,
      }),
    ).resolves.toEqual({ ok: true })
    expect(optOut.setOptedOut).not.toHaveBeenCalled()
  })
})

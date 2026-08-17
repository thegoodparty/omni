import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  classifyInboundMessage,
  verifySinchSignature,
} from './sinchSignature.util'

const SECRET = 'test_webhook_secret'
const RAW_BODY =
  '{"message":{"channel_identity":{"channel":"SMS","identity":"+15551234567"}}}'
const NONCE = 'nonce-1'
const TIMESTAMP = '1786392510'

const sign = (rawBody: string, nonce = NONCE, timestamp = TIMESTAMP) =>
  createHmac('sha256', SECRET)
    .update(`${rawBody}.${nonce}.${timestamp}`)
    .digest('base64')

describe('verifySinchSignature', () => {
  it('accepts a correctly signed payload', () => {
    expect(
      verifySinchSignature({
        rawBody: RAW_BODY,
        signature: sign(RAW_BODY),
        nonce: NONCE,
        timestamp: TIMESTAMP,
        secret: SECRET,
      }),
    ).toBe(true)
  })

  it('rejects a tampered body', () => {
    expect(
      verifySinchSignature({
        rawBody:
          '{"message":{"channel_identity":{"channel":"SMS","identity":"+15559999999"}}}',
        signature: sign(RAW_BODY),
        nonce: NONCE,
        timestamp: TIMESTAMP,
        secret: SECRET,
      }),
    ).toBe(false)
  })

  it('rejects a replayed signature under a different nonce or timestamp', () => {
    const signature = sign(RAW_BODY)
    expect(
      verifySinchSignature({
        rawBody: RAW_BODY,
        signature,
        nonce: 'nonce-2',
        timestamp: TIMESTAMP,
        secret: SECRET,
      }),
    ).toBe(false)
    expect(
      verifySinchSignature({
        rawBody: RAW_BODY,
        signature,
        nonce: NONCE,
        timestamp: '1786392999',
        secret: SECRET,
      }),
    ).toBe(false)
  })

  it('rejects the wrong secret', () => {
    expect(
      verifySinchSignature({
        rawBody: RAW_BODY,
        signature: sign(RAW_BODY),
        nonce: NONCE,
        timestamp: TIMESTAMP,
        secret: 'not_the_secret',
      }),
    ).toBe(false)
  })

  it('fails closed on missing headers or secret', () => {
    const base = {
      rawBody: RAW_BODY,
      signature: sign(RAW_BODY),
      nonce: NONCE,
      timestamp: TIMESTAMP,
      secret: SECRET,
    }
    expect(verifySinchSignature({ ...base, signature: undefined })).toBe(false)
    expect(verifySinchSignature({ ...base, nonce: undefined })).toBe(false)
    expect(verifySinchSignature({ ...base, timestamp: undefined })).toBe(false)
    expect(verifySinchSignature({ ...base, secret: '' })).toBe(false)
  })

  it('rejects a signature of the wrong length without throwing', () => {
    // timingSafeEqual throws on a length mismatch, so this guards the length
    // pre-check rather than the comparison.
    expect(() =>
      verifySinchSignature({
        rawBody: RAW_BODY,
        signature: 'short',
        nonce: NONCE,
        timestamp: TIMESTAMP,
        secret: SECRET,
      }),
    ).not.toThrow()
  })
})

describe('classifyInboundMessage', () => {
  it('recognizes opt-out keywords regardless of case and padding', () => {
    expect(classifyInboundMessage('STOP')).toBe('opt_out')
    expect(classifyInboundMessage(' stop ')).toBe('opt_out')
    expect(classifyInboundMessage('Stop.')).toBe('opt_out')
    expect(classifyInboundMessage('UNSUBSCRIBE')).toBe('opt_out')
    expect(classifyInboundMessage('cancel')).toBe('opt_out')
  })

  it('recognizes explicit opt-in keywords', () => {
    expect(classifyInboundMessage('START')).toBe('opt_in')
    expect(classifyInboundMessage('unstop')).toBe('opt_in')
  })

  it('does not treat a keyword inside a sentence as an opt-out', () => {
    // Matching a substring here would opt someone out for saying the opposite.
    expect(classifyInboundMessage('please do not cancel my account')).toBe(
      'other',
    )
    expect(classifyInboundMessage('can you stop by tomorrow?')).toBe('other')
  })

  it('treats an empty or missing body as other', () => {
    expect(classifyInboundMessage(undefined)).toBe('other')
    expect(classifyInboundMessage('')).toBe('other')
  })
})

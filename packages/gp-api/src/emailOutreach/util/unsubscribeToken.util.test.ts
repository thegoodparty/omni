import { createHmac, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from './unsubscribeToken.util'

// Copied from packages/gp-webapp/middleware.ts config.matcher.
const STATIC_FILE_PATTERN = new RegExp(
  '[^?]*\\.(?:html?|css|js(?:on)?|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)',
)

const payload = {
  email: 'neighbor@example.com',
  organizationSlug: 'campaign-renee-wells',
  outreachEmailId: 42,
  issuedAt: 1_793_000_000,
}

describe('unsubscribe tokens', () => {
  it('verifies a token it signed', () => {
    const token = signUnsubscribeToken('key-a', payload)
    expect(verifyUnsubscribeToken('key-a', token)).toEqual(payload)
  })

  it('refuses a token signed with another key', () => {
    const token = signUnsubscribeToken('key-a', payload)
    expect(verifyUnsubscribeToken('key-b', token)).toBeNull()
  })

  it('refuses a tampered payload', () => {
    const token = signUnsubscribeToken('key-a', payload)
    const [, signature] = token.split('~')
    const forged = Buffer.from(
      JSON.stringify({ ...payload, email: 'someone@example.com' }),
    ).toString('base64url')
    expect(verifyUnsubscribeToken('key-a', `${forged}~${signature}`)).toBeNull()
  })

  it('refuses garbage', () => {
    expect(verifyUnsubscribeToken('key-a', 'not-a-token')).toBeNull()
    expect(verifyUnsubscribeToken('key-a', 'a.b.c')).toBeNull()
  })

  it('is URL safe', () => {
    expect(signUnsubscribeToken('key-a', payload)).toMatch(/^[\w-]+~[\w-]+$/)
  })

  it('never looks like a static file path', () => {
    for (let i = 0; i < 20_000; i++) {
      const token = signUnsubscribeToken(`key-${i}`, {
        ...payload,
        outreachEmailId: i,
      })
      expect(`/email/unsubscribe/${token}`).not.toMatch(STATIC_FILE_PATTERN)
    }
  })

  it('shows the old format was the problem', () => {
    expect('/email/unsubscribe/abc.json1x').toMatch(STATIC_FILE_PATTERN)
  })

  it('still verifies a token issued in the old dot format', () => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signature = createHmac('sha256', 'key-a')
      .update(body)
      .digest('base64url')
    expect(verifyUnsubscribeToken('key-a', `${body}.${signature}`)).toEqual(
      payload,
    )
  })

  it('refuses a tampered old-format token', () => {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    expect(verifyUnsubscribeToken('key-a', `${body}.AAAA`)).toBeNull()
  })

  it('refuses a token with extra separators', () => {
    const token = signUnsubscribeToken('key-a', payload)
    expect(verifyUnsubscribeToken('key-a', `${token}~x`)).toBeNull()
  })

  it('forward-confirm tokens are plain base64url with no dot', () => {
    const token = randomBytes(32).toString('base64url')
    expect(`/email/forward-confirm/${token}`).not.toMatch(STATIC_FILE_PATTERN)
  })
})

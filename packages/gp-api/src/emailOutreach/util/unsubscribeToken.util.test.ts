import { describe, expect, it } from 'vitest'
import {
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from './unsubscribeToken.util'

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
    const [, signature] = token.split('.')
    const forged = Buffer.from(
      JSON.stringify({ ...payload, email: 'someone@example.com' }),
    ).toString('base64url')
    expect(verifyUnsubscribeToken('key-a', `${forged}.${signature}`)).toBeNull()
  })

  it('refuses garbage', () => {
    expect(verifyUnsubscribeToken('key-a', 'not-a-token')).toBeNull()
    expect(verifyUnsubscribeToken('key-a', 'a.b.c')).toBeNull()
  })

  it('is URL safe', () => {
    expect(signUnsubscribeToken('key-a', payload)).toMatch(/^[\w-]+\.[\w-]+$/)
  })
})

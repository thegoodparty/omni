import { describe, expect, it } from 'vitest'
import { capName, emailDomain, normalizeEmail } from './emailAddress.util'

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Ann@Example.COM ')).toBe('ann@example.com')
  })

  it('rejects malformed addresses', () => {
    expect(normalizeEmail('not-an-email')).toBeNull()
    expect(normalizeEmail('a@')).toBeNull()
    expect(normalizeEmail('')).toBeNull()
  })
})

describe('capName', () => {
  it('caps at 100 characters and nulls blanks', () => {
    expect(capName('a'.repeat(120))).toHaveLength(100)
    expect(capName('   ')).toBeNull()
  })
})

describe('emailDomain', () => {
  it('returns the part after the last @', () => {
    expect(emailDomain('ann@example.com')).toBe('example.com')
  })
})

import { describe, expect, it } from 'vitest'
import { isInternalUser, isTestUser, newFixtureUserEmail } from './users.util'

describe('isTestUser', () => {
  it('matches e2e users on the test domain', () => {
    expect(isTestUser({ email: 'headless-1@test.goodparty.org' })).toBe(true)
  })

  it('matches minted fixture emails, keeping builder and pattern in sync', () => {
    expect(isTestUser({ email: newFixtureUserEmail() })).toBe(true)
  })

  it('matches an uppercased fixture email', () => {
    expect(isTestUser({ email: newFixtureUserEmail().toUpperCase() })).toBe(
      true,
    )
  })

  it('does not match staff @goodparty.org accounts', () => {
    expect(isTestUser({ email: 'tomer@goodparty.org' })).toBe(false)
  })

  it('does not match a staff qa- alias without a uuid local part', () => {
    expect(isTestUser({ email: 'qa-team@goodparty.org' })).toBe(false)
  })

  it('does not match a fixture-shaped local part on another domain', () => {
    const hijacked = newFixtureUserEmail().replace(
      '@goodparty.org',
      '@goodparty.org.attacker.tld',
    )
    expect(isTestUser({ email: hijacked })).toBe(false)
  })
})

describe('isInternalUser', () => {
  it('treats staff, e2e, and fixture emails as internal', () => {
    expect(isInternalUser({ email: 'tomer@goodparty.org' })).toBe(true)
    expect(isInternalUser({ email: 'e2e@test.goodparty.org' })).toBe(true)
    expect(isInternalUser({ email: newFixtureUserEmail() })).toBe(true)
    expect(isInternalUser({ email: 'voter@gmail.com' })).toBe(false)
  })
})

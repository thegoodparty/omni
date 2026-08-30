import { describe, expect, it } from 'vitest'
import { isTestUser } from './test-users'

describe('isTestUser', () => {
  it('matches e2e users on the test domain', () => {
    expect(isTestUser({ email: 'headless-1@test.goodparty.org' })).toBe(true)
  })

  it('matches qa fixture emails on the internal domain', () => {
    expect(
      isTestUser({
        email: 'qa-0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d@goodparty.org',
      }),
    ).toBe(true)
  })

  it('does not match staff @goodparty.org accounts', () => {
    expect(isTestUser({ email: 'tomer@goodparty.org' })).toBe(false)
    expect(isTestUser({ email: 'qa-team@goodparty.org' })).toBe(false)
  })
})

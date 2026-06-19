import { describe, it, expect } from 'vitest'
import { isServeRoutePath } from './serveRoutes'

describe('isServeRoutePath', () => {
  it('matches serve route prefixes and their sub-paths', () => {
    expect(isServeRoutePath('/dashboard/chief-of-staff')).toBe(true)
    expect(isServeRoutePath('/dashboard/chief-of-staff/archive')).toBe(true)
    expect(isServeRoutePath('/dashboard/briefings')).toBe(true)
    expect(isServeRoutePath('/dashboard/briefings/2026-01-15')).toBe(true)
    expect(isServeRoutePath('/dashboard/polls')).toBe(true)
    expect(isServeRoutePath('/dashboard/polls/42/expand')).toBe(true)
    expect(isServeRoutePath('/dashboard/admin-review/briefings')).toBe(true)
    expect(
      isServeRoutePath('/dashboard/admin-review/briefings/2026-01-15'),
    ).toBe(true)
    expect(isServeRoutePath('/serve/onboarding')).toBe(true)
    expect(isServeRoutePath('/serve/onboarding/office')).toBe(true)
  })

  it('excludes the public /serve/welcome redemption page', () => {
    // /serve/welcome is reached pre-auth via the magic link; treating it as a
    // serve route would overwrite the org-slug cookie during post-auth.
    expect(isServeRoutePath('/serve/welcome')).toBe(false)
    expect(isServeRoutePath('/serve/welcome?__clerk_ticket=abc')).toBe(false)
    expect(isServeRoutePath('/serve')).toBe(false)
  })

  it('ignores query strings and hashes when matching', () => {
    expect(isServeRoutePath('/dashboard/polls?tab=open')).toBe(true)
    expect(isServeRoutePath('/dashboard/briefings#section')).toBe(true)
    expect(isServeRoutePath('/dashboard/briefings/2026-01-15?x=1#y')).toBe(true)
  })

  it('does not match non-serve routes or prefix look-alikes', () => {
    expect(isServeRoutePath('/dashboard')).toBe(false)
    expect(isServeRoutePath('/dashboard/profile')).toBe(false)
    expect(isServeRoutePath('/dashboard/briefings-archive')).toBe(false)
    expect(isServeRoutePath('/dashboard/pollsters')).toBe(false)
  })
})

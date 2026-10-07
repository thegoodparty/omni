import { describe, it, expect } from 'vitest'
import { isServeRoutePath } from './serveRoutes'

describe('isServeRoutePath', () => {
  it('matches serve route prefixes and their sub-paths', () => {
    expect(isServeRoutePath('/chief-of-staff')).toBe(true)
    expect(isServeRoutePath('/chief-of-staff/archive')).toBe(true)
    expect(isServeRoutePath('/briefings')).toBe(true)
    expect(isServeRoutePath('/briefings/2026-01-15')).toBe(true)
    expect(isServeRoutePath('/polls')).toBe(true)
    expect(isServeRoutePath('/polls/42/expand')).toBe(true)
    expect(isServeRoutePath('/admin-review/briefings')).toBe(true)
    expect(isServeRoutePath('/admin-review/briefings/2026-01-15')).toBe(true)
    expect(isServeRoutePath('/serve/onboarding')).toBe(true)
    expect(isServeRoutePath('/serve/onboarding/office')).toBe(true)
    expect(isServeRoutePath('/constituent-outreach')).toBe(true)
    expect(isServeRoutePath('/constituent-outreach/history')).toBe(true)
  })

  it('excludes the public /serve/welcome redemption page', () => {
    // /serve/welcome is reached pre-auth via the magic link; treating it as a
    // serve route would overwrite the org-slug cookie during post-auth.
    expect(isServeRoutePath('/serve/welcome')).toBe(false)
    expect(isServeRoutePath('/serve/welcome?__clerk_ticket=abc')).toBe(false)
    expect(isServeRoutePath('/serve')).toBe(false)
  })

  it('excludes the polls onboarding that lives outside the dashboard', () => {
    expect(isServeRoutePath('/polls/onboarding')).toBe(false)
    expect(isServeRoutePath('/polls/onboarding/success')).toBe(false)
    expect(isServeRoutePath('/polls/welcome')).toBe(false)
  })

  it('ignores query strings and hashes when matching', () => {
    expect(isServeRoutePath('/polls?tab=open')).toBe(true)
    expect(isServeRoutePath('/briefings#section')).toBe(true)
    expect(isServeRoutePath('/briefings/2026-01-15?x=1#y')).toBe(true)
  })

  it('does not match non-serve routes or prefix look-alikes', () => {
    expect(isServeRoutePath('/home')).toBe(false)
    expect(isServeRoutePath('/profile')).toBe(false)
    expect(isServeRoutePath('/briefings-archive')).toBe(false)
    expect(isServeRoutePath('/pollsters')).toBe(false)
  })
})

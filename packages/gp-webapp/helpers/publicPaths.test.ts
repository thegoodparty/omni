import { describe, expect, it } from 'vitest'
import {
  PUBLIC_PATH_PREFIXES,
  isPublicPath,
  publicPathMatcher,
} from '@shared/auth/publicPaths'

// middleware.ts builds its Clerk matcher from this list and the 401 guard reads
// the same one, so a page can't be public on one side and session-gated on the
// other (ENG-11674).
describe('isPublicPath', () => {
  it('matches the routes a visitor with no session can see, and their children', () => {
    expect(isPublicPath('/')).toBe(true)
    expect(isPublicPath('/sign-up')).toBe(true)
    expect(isPublicPath('/login')).toBe(true)
    expect(isPublicPath('/email/unsubscribe')).toBe(true)
    expect(isPublicPath('/serve/welcome')).toBe(true)
    expect(isPublicPath('/team-invite')).toBe(true)
  })

  it('does not match pages that require a session', () => {
    expect(isPublicPath('/dashboard/campaign-plan')).toBe(false)
    expect(isPublicPath('/onboarding/onboarding-1/office')).toBe(false)
    expect(isPublicPath('/serve/onboarding')).toBe(false)
    expect(isPublicPath('/dashboard/email')).toBe(false)
  })

  it('does not make a longer sibling public', () => {
    expect(isPublicPath('/developers')).toBe(false)
    expect(isPublicPath('/login-help')).toBe(false)
  })

  it('spells the same prefixes for the Clerk matcher', () => {
    for (const prefix of PUBLIC_PATH_PREFIXES) {
      expect(prefix.endsWith('/')).toBe(false)
      expect(publicPathMatcher(prefix)).toBe(`${prefix}(/.*)?`)
    }
  })
})

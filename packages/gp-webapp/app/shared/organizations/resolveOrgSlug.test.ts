import { describe, it, expect } from 'vitest'
import type { Organization } from 'gpApi/api-endpoints'
import { resolveOrgSlug } from './resolveOrgSlug'

const org = (slug: string): Organization => ({
  slug,
  name: slug,
  positionName: null,
  position: null,
  district: null,
  electedOfficeId: null,
  campaignId: 1,
  status: 'active',
})

// gp-api returns the default org first, so these fixtures are in server order.
const heldOffice = org('eo-9')
const campaign = org('campaign-1')

describe('resolveOrgSlug', () => {
  it('honors a valid cookie over the server default', () => {
    // The user's own pick from the switcher. Nothing may override it, or
    // switching to your campaign would bounce you back to Serve on reload.
    expect(resolveOrgSlug([heldOffice, campaign], 'campaign-1')).toBe(
      'campaign-1',
    )
  })

  it('takes the first org when the cookie is absent', () => {
    expect(resolveOrgSlug([heldOffice, campaign], null)).toBe('eo-9')
  })

  it('takes the first org when the cookie names an org this user cannot see', () => {
    // The impersonation case: a slug left by whoever used this browser last.
    expect(resolveOrgSlug([heldOffice, campaign], 'campaign-999')).toBe('eo-9')
  })

  it('treats `false` from the cookie helper as no cookie', () => {
    // getCookie returns false, not null, when the cookie is missing.
    expect(resolveOrgSlug([heldOffice, campaign], false)).toBe('eo-9')
  })

  it('returns null when the user has no organizations', () => {
    expect(resolveOrgSlug([], 'anything')).toBeNull()
  })

  describe('orgs that cannot serve a route (ENG-11606)', () => {
    const empty = (slug: string, over: Partial<Organization> = {}) => ({
      ...org(slug),
      campaignId: null,
      ...over,
    })
    const pastOffice = empty('eo-old', {
      electedOfficeId: 'eo-old',
      status: 'past',
    })

    it('ignores a cookie for a campaign-less past office and falls back to the campaign', () => {
      expect(resolveOrgSlug([pastOffice, campaign], 'eo-old')).toBe(
        'campaign-1',
      )
    })

    it('ignores a cookie for an org with neither campaign nor office', () => {
      expect(resolveOrgSlug([empty('bare'), campaign], 'bare')).toBe(
        'campaign-1',
      )
    })

    it('still honors a cookie for a currently held office', () => {
      expect(resolveOrgSlug([campaign, heldOffice], 'eo-9')).toBe('eo-9')
    })

    it('impersonation (no cookie) skips a leading unusable org', () => {
      expect(resolveOrgSlug([pastOffice, campaign], null)).toBe('campaign-1')
    })

    it('keeps the first org when none is usable', () => {
      expect(resolveOrgSlug([pastOffice], 'eo-old')).toBe('eo-old')
    })
  })
})

import { describe, it, expect } from 'vitest'
import { buildPlanPitch, formatPlanCents } from './planPitch'

describe('buildPlanPitch', () => {
  it('pitches Pro at the Pro price when Team is not recommended', () => {
    expect(buildPlanPitch(true, true, false)).toEqual({
      ready: true,
      enabled: true,
      plan: 'pro',
      name: 'Pro',
      price: '$299',
      credit: '$175',
      allPlansHref: '/dashboard/plans',
    })
  })

  it('pitches Team and highlights it on the plans page', () => {
    expect(buildPlanPitch(true, true, true)).toMatchObject({
      plan: 'team',
      name: 'Team',
      price: '$399',
      allPlansHref: '/dashboard/plans?highlight=team',
    })
  })

  it('adds the page the pitch is on as backTo, after the highlight', () => {
    expect(
      buildPlanPitch(true, true, true, '/dashboard/contacts').allPlansHref,
    ).toBe('/dashboard/plans?highlight=team&backTo=%2Fdashboard%2Fcontacts')
  })

  it.each([
    null,
    undefined,
    '/dashboard/billing',
    'https://evil.test',
    '/dashboard/plans',
  ])('drops %s as backTo', (backTo) => {
    expect(buildPlanPitch(true, true, false, backTo).allPlansHref).toBe(
      '/dashboard/plans',
    )
  })

  it('formats non-whole dollar amounts with cents', () => {
    expect(formatPlanCents(12550)).toBe('$125.50')
  })
})

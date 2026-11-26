import { describe, it, expect } from 'vitest'
import {
  carryQueryString,
  parseProUpgradeCarry,
  parsePlansBackTo,
  parseReturnTo,
  plansHrefWithBackTo,
} from './proUpgradePlanParams'

describe('parseReturnTo', () => {
  it('keeps an allowlisted dashboard path', () => {
    expect(parseReturnTo('/dashboard/team')).toBe('/dashboard/team')
  })

  it('drops the query so a returnTo cannot smuggle parameters through', () => {
    expect(parseReturnTo('/dashboard/team?x=1')).toBe('/dashboard/team')
  })

  it.each([
    'https://evil.example/dashboard/team',
    '//evil.example/dashboard/team',
    '/\\evil.example',
    '/dashboard/team/../../admin',
    '/dashboard/billing',
    '/login',
    'dashboard/team',
    '',
  ])('ignores %s', (value) => {
    expect(parseReturnTo(value)).toBeNull()
  })
})

describe('parsePlansBackTo', () => {
  it.each([
    '/dashboard',
    '/dashboard/team',
    '/dashboard/outreach',
    '/dashboard/contacts',
    '/dashboard/account',
    '/dashboard/race-opponent',
  ])('keeps %s', (path) => {
    expect(parsePlansBackTo(path)).toBe(path)
  })

  it.each([
    '/dashboard/plans',
    '/dashboard/billing',
    'https://evil.example/dashboard',
    '//evil.example',
    '',
    null,
    undefined,
  ])('ignores %s', (value) => {
    expect(parsePlansBackTo(value)).toBeNull()
  })
})

describe('plans round trip through checkout', () => {
  it('keeps the original page on the plans page a Back off checkout returns to', () => {
    const plans = plansHrefWithBackTo('/dashboard/contacts')
    expect(plans).toBe('/dashboard/plans?backTo=%2Fdashboard%2Fcontacts')

    const carry = parseProUpgradeCarry(new URLSearchParams({ back: plans }))
    expect(carry.backTo).toBe(plans)
    const plansUrl = new URL(carry.backTo ?? '', 'http://x.test')
    expect(parsePlansBackTo(plansUrl.searchParams.get('backTo'))).toBe(
      '/dashboard/contacts',
    )
  })

  it('re-appends the original page to every step URL', () => {
    const plans = plansHrefWithBackTo('/dashboard/team')
    const carry = parseProUpgradeCarry(new URLSearchParams({ back: plans }))
    const next = parseProUpgradeCarry(
      new URLSearchParams(carryQueryString(carry)),
    )
    expect(next.backTo).toBe(plans)
  })

  it('drops a nested backTo that is not allowed', () => {
    const carry = parseProUpgradeCarry(
      new URLSearchParams({
        back: '/dashboard/plans?backTo=https://evil.test',
      }),
    )
    expect(carry.backTo).toBe('/dashboard/plans')
  })

  it('does not nest plans inside plans', () => {
    expect(parseReturnTo('/dashboard/plans?backTo=/dashboard/plans')).toBe(
      '/dashboard/plans',
    )
  })
})

describe('parseProUpgradeCarry', () => {
  it('reads plan, returnTo, back and from', () => {
    const params = new URLSearchParams(
      'plan=team&returnTo=%2Fdashboard%2Fteam&back=%2Fdashboard%2Fplans&from=pro',
    )
    expect(parseProUpgradeCarry(params)).toEqual({
      plan: 'team',
      returnTo: '/dashboard/team',
      backTo: '/dashboard/plans',
      fromPro: true,
    })
  })

  it('ignores an unknown plan and a returnTo outside the allowlist', () => {
    const params = new URLSearchParams(
      'plan=free&returnTo=https://evil.test&back=//evil.test',
    )
    expect(parseProUpgradeCarry(params)).toEqual({
      plan: null,
      returnTo: null,
      backTo: null,
      fromPro: false,
    })
  })
})

describe('carryQueryString', () => {
  it('round-trips through the parser', () => {
    const carry = {
      plan: 'team',
      returnTo: '/dashboard/team',
      backTo: '/dashboard/plans',
      fromPro: true,
    } as const
    expect(
      parseProUpgradeCarry(new URLSearchParams(carryQueryString(carry))),
    ).toEqual(carry)
  })

  it('is empty when nothing is carried', () => {
    expect(
      carryQueryString({
        plan: null,
        returnTo: null,
        backTo: null,
        fromPro: false,
      }),
    ).toBe('')
  })
})

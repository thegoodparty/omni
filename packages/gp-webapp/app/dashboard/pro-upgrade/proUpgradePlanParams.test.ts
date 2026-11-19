import { describe, it, expect } from 'vitest'
import {
  carryQueryString,
  parseProUpgradeCarry,
  parseReturnTo,
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

describe('parseProUpgradeCarry', () => {
  it('reads plan, returnTo and from', () => {
    const params = new URLSearchParams(
      'plan=team&returnTo=%2Fdashboard%2Fteam&from=pro',
    )
    expect(parseProUpgradeCarry(params)).toEqual({
      plan: 'team',
      returnTo: '/dashboard/team',
      fromPro: true,
    })
  })

  it('ignores an unknown plan and a returnTo outside the allowlist', () => {
    const params = new URLSearchParams('plan=free&returnTo=https://evil.test')
    expect(parseProUpgradeCarry(params)).toEqual({
      plan: null,
      returnTo: null,
      fromPro: false,
    })
  })
})

describe('carryQueryString', () => {
  it('round-trips through the parser', () => {
    const carry = {
      plan: 'team',
      returnTo: '/dashboard/team',
      fromPro: true,
    } as const
    expect(
      parseProUpgradeCarry(new URLSearchParams(carryQueryString(carry))),
    ).toEqual(carry)
  })

  it('is empty when nothing is carried', () => {
    expect(
      carryQueryString({ plan: null, returnTo: null, fromPro: false }),
    ).toBe('')
  })
})

import { describe, expect, it } from 'vitest'
import { areaForPath } from './productMap'

describe('areaForPath', () => {
  it('finds the tab a page sits under, by its most specific path', () => {
    expect(areaForPath('win', '/dashboard/contacts')?.name).toBe('Voter Data')
    expect(areaForPath('win', '/dashboard/contacts/lists/12')?.name).toBe(
      'Voter Data',
    )
    expect(areaForPath('win', '/dashboard/outreach')?.name).toBe(
      'Voter Outreach',
    )
  })

  it('matches the home tab only on the home page itself', () => {
    expect(areaForPath('win', '/dashboard')?.path).toBe('/dashboard')
    expect(areaForPath('win', '/dashboard/not-a-page')).toBeNull()
  })

  it("reads each product's own entry for a shared path", () => {
    expect(areaForPath('serve', '/dashboard/contacts')?.name).toBe(
      'Constituent Data',
    )
  })

  it('matches a bracketed segment against any one segment', () => {
    expect(
      areaForPath('serve', '/dashboard/issue-capture/42/review')?.path,
    ).toBe('/dashboard/issue-capture/[outreachId]/review')
  })

  it('never matches a path outside the dashboard', () => {
    expect(areaForPath('win', '/login')).toBeNull()
  })
})

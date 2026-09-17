import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Organization } from 'gpApi/api-endpoints'
import { TEAM_ACCOUNTS_FLAG_KEY } from '@shared/experiments/teamAccountsFlag'

const { mockGetCurrentUserOrganizations, mockGetFlagVariants, mockCookies } =
  vi.hoisted(() => ({
    mockGetCurrentUserOrganizations: vi.fn(),
    mockGetFlagVariants: vi.fn(),
    mockCookies: vi.fn(),
  }))

vi.mock('helpers/getCurrentUserOrganizations', () => ({
  getCurrentUserOrganizations: () => mockGetCurrentUserOrganizations(),
}))
vi.mock('@shared/experiments/getFlagVariants', () => ({
  getFlagVariants: () => mockGetFlagVariants(),
}))
vi.mock('next/headers', () => ({
  cookies: () => mockCookies(),
}))

import { isActiveOrgVolunteer } from './activeOrgVolunteer.server'

const org = (slug: string, role: Organization['role']): Organization => ({
  slug,
  name: slug,
  positionName: null,
  position: null,
  district: null,
  electedOfficeId: null,
  campaignId: 1,
  status: 'active',
  role,
})

const cookieStore = (slug: string | undefined) => ({
  get: (name: string) =>
    name === 'organization-slug' && slug ? { value: slug } : undefined,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockCookies.mockResolvedValue(cookieStore(undefined))
})

describe('isActiveOrgVolunteer', () => {
  it('returns false when the flag is off, even for a volunteer active org', async () => {
    mockGetCurrentUserOrganizations.mockResolvedValue([
      org('org-one', 'volunteer'),
    ])
    mockGetFlagVariants.mockResolvedValue({
      [TEAM_ACCOUNTS_FLAG_KEY]: { value: 'off' },
    })

    await expect(isActiveOrgVolunteer()).resolves.toBe(false)
  })

  it('returns false when the flag cannot be resolved', async () => {
    mockGetCurrentUserOrganizations.mockResolvedValue([
      org('org-one', 'volunteer'),
    ])
    mockGetFlagVariants.mockResolvedValue(null)

    await expect(isActiveOrgVolunteer()).resolves.toBe(false)
  })

  it('returns true for the cookie-selected org when its role is volunteer, flag on', async () => {
    mockGetCurrentUserOrganizations.mockResolvedValue([
      org('org-one', 'owner'),
      org('org-two', 'volunteer'),
    ])
    mockGetFlagVariants.mockResolvedValue({
      [TEAM_ACCOUNTS_FLAG_KEY]: { value: 'on' },
    })
    mockCookies.mockResolvedValue(cookieStore('org-two'))

    await expect(isActiveOrgVolunteer()).resolves.toBe(true)
  })

  it('falls back to the first org when the cookie points at an unknown slug', async () => {
    mockGetCurrentUserOrganizations.mockResolvedValue([
      org('org-one', 'volunteer'),
      org('org-two', 'owner'),
    ])
    mockGetFlagVariants.mockResolvedValue({
      [TEAM_ACCOUNTS_FLAG_KEY]: { value: 'on' },
    })
    mockCookies.mockResolvedValue(cookieStore('stale-slug'))

    await expect(isActiveOrgVolunteer()).resolves.toBe(true)
  })

  it('returns false for an owner/manager active org, flag on', async () => {
    mockGetCurrentUserOrganizations.mockResolvedValue([
      org('org-one', 'campaignAdmin'),
    ])
    mockGetFlagVariants.mockResolvedValue({
      [TEAM_ACCOUNTS_FLAG_KEY]: { value: 'on' },
    })

    await expect(isActiveOrgVolunteer()).resolves.toBe(false)
  })
})

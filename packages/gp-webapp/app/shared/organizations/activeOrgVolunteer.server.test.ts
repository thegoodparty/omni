import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Organization } from 'gpApi/api-endpoints'

const { mockGetCurrentUserOrganizations, mockCookies } = vi.hoisted(() => ({
  mockGetCurrentUserOrganizations: vi.fn(),
  mockCookies: vi.fn(),
}))

vi.mock('helpers/getCurrentUserOrganizations', () => ({
  getCurrentUserOrganizations: () => mockGetCurrentUserOrganizations(),
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
  it('returns true for the cookie-selected org when its role is volunteer', async () => {
    mockGetCurrentUserOrganizations.mockResolvedValue([
      org('org-one', 'owner'),
      org('org-two', 'volunteer'),
    ])
    mockCookies.mockResolvedValue(cookieStore('org-two'))

    await expect(isActiveOrgVolunteer()).resolves.toBe(true)
  })

  it('falls back to the first org when the cookie points at an unknown slug', async () => {
    mockGetCurrentUserOrganizations.mockResolvedValue([
      org('org-one', 'volunteer'),
      org('org-two', 'owner'),
    ])
    mockCookies.mockResolvedValue(cookieStore('stale-slug'))

    await expect(isActiveOrgVolunteer()).resolves.toBe(true)
  })

  it('returns false for an owner/manager active org', async () => {
    mockGetCurrentUserOrganizations.mockResolvedValue([
      org('org-one', 'campaignAdmin'),
    ])

    await expect(isActiveOrgVolunteer()).resolves.toBe(false)
  })
})

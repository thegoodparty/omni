import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SERVE_IMPORT_CONTACTS_FLAG } from '@goodparty_org/contracts'
import { importContactsAccess } from './importContactsAccess'

const {
  mockCandidateAccess,
  mockGetFlagVariants,
  mockServerRequest,
  mockFetchUserCampaign,
  mockNotFound,
} = vi.hoisted(() => ({
  mockCandidateAccess: vi.fn(),
  mockGetFlagVariants: vi.fn(),
  mockServerRequest: vi.fn(),
  mockFetchUserCampaign: vi.fn(),
  mockNotFound: vi.fn(),
}))

vi.mock('../../shared/candidateAccess', () => ({
  default: () => mockCandidateAccess(),
}))
vi.mock('@shared/experiments/getFlagVariants', () => ({
  getFlagVariants: () => mockGetFlagVariants(),
}))
vi.mock('gpApi/server-request', () => ({
  serverRequest: (...args: unknown[]) => mockServerRequest(...args),
}))
vi.mock('app/onboarding/shared/getCampaign', () => ({
  fetchUserCampaign: () => mockFetchUserCampaign(),
}))
vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
}))

const NOT_FOUND = new Error('NEXT_NOT_FOUND')

const flag = (value: 'on' | 'off') =>
  mockGetFlagVariants.mockResolvedValue({
    [SERVE_IMPORT_CONTACTS_FLAG]: { value },
  })

const electedOffice = (found: boolean) =>
  mockServerRequest.mockResolvedValue(
    found ? { ok: true, data: { id: 'eo-1' } } : { ok: false, data: undefined },
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockNotFound.mockImplementation(() => {
    throw NOT_FOUND
  })
  mockFetchUserCampaign.mockResolvedValue(null)
})

describe('importContactsAccess', () => {
  it('lets an elected official in as Serve with the flag on', async () => {
    flag('on')
    electedOffice(true)

    await expect(importContactsAccess()).resolves.toEqual({ isWin: false })
    expect(mockCandidateAccess).toHaveBeenCalled()
    expect(mockFetchUserCampaign).not.toHaveBeenCalled()
  })

  it('lets a Pro campaign in as Win with the flag on', async () => {
    flag('on')
    electedOffice(false)
    mockFetchUserCampaign.mockResolvedValue({ isPro: true })

    await expect(importContactsAccess()).resolves.toEqual({ isWin: true })
  })

  it('404s a campaign without Pro', async () => {
    flag('on')
    electedOffice(false)
    mockFetchUserCampaign.mockResolvedValue({ isPro: false })

    await expect(importContactsAccess()).rejects.toBe(NOT_FOUND)
  })

  it('404s with the flag off, before reading the org', async () => {
    flag('off')

    await expect(importContactsAccess()).rejects.toBe(NOT_FOUND)
    expect(mockServerRequest).not.toHaveBeenCalled()
  })
})

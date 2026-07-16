import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from 'helpers/types'

const LATENCY_MS = 50

const {
  mockCandidateAccess,
  mockGetServerUser,
  mockFetchUserCampaign,
  mockFetchCanDownload,
  mockRedirect,
} = vi.hoisted(() => ({
  mockCandidateAccess: vi.fn(),
  mockGetServerUser: vi.fn(),
  mockFetchUserCampaign: vi.fn(),
  mockFetchCanDownload: vi.fn(),
  mockRedirect: vi.fn(),
}))

vi.mock('../shared/candidateAccess', () => ({
  default: () => mockCandidateAccess(),
}))
vi.mock('helpers/userServerHelper', () => ({
  getServerUser: () => mockGetServerUser(),
}))
vi.mock('app/onboarding/shared/getCampaign', () => ({
  fetchUserCampaign: () => mockFetchUserCampaign(),
}))
vi.mock('./utils', () => ({
  fetchCanDownload: () => mockFetchCanDownload(),
}))
vi.mock('./components/VoterRecordsPage', () => ({
  default: () => null,
}))
vi.mock('helpers/metadataHelper', () => ({
  default: () => ({}),
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}))

import Page from './page'

class RedirectError extends Error {
  constructor(public url: string) {
    super(`redirect:${url}`)
    this.name = 'RedirectError'
  }
}

const proCampaign = { id: 1, isPro: true } as unknown as Campaign
const freeCampaign = { id: 1, isPro: false } as unknown as Campaign

const delay = <T>(value: T, ms = LATENCY_MS): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms))

// Mirrors the ORIGINAL serial ordering of the page so we can benchmark the
// pre-parallelization wall time against the same mocked latencies.
async function serialBaseline(): Promise<void> {
  await mockCandidateAccess()
  await mockGetServerUser()
  const campaign = (await mockFetchUserCampaign()) as Campaign | null
  if (!campaign?.isPro) {
    mockRedirect('/dashboard/pro-upgrade')
    return
  }
  await mockFetchCanDownload()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCandidateAccess.mockResolvedValue(undefined)
  mockRedirect.mockImplementation((url: string) => {
    throw new RedirectError(url)
  })
})

describe('voter-records Page behavior', () => {
  it('redirects non-pro users to pro-upgrade and never fetches canDownload', async () => {
    mockGetServerUser.mockResolvedValue({ id: 7 })
    mockFetchUserCampaign.mockResolvedValue(freeCampaign)
    mockFetchCanDownload.mockResolvedValue(true)

    await expect(Page()).rejects.toMatchObject({
      name: 'RedirectError',
      url: '/dashboard/pro-upgrade',
    })

    expect(mockGetServerUser).toHaveBeenCalledTimes(1)
    expect(mockFetchUserCampaign).toHaveBeenCalledTimes(1)
    expect(mockFetchCanDownload).not.toHaveBeenCalled()
  })

  it('renders for pro users after fetching user + campaign + canDownload', async () => {
    mockGetServerUser.mockResolvedValue({ id: 7 })
    mockFetchUserCampaign.mockResolvedValue(proCampaign)
    mockFetchCanDownload.mockResolvedValue(true)

    await expect(Page()).resolves.toBeDefined()

    expect(mockRedirect).not.toHaveBeenCalled()
    expect(mockGetServerUser).toHaveBeenCalledTimes(1)
    expect(mockFetchUserCampaign).toHaveBeenCalledTimes(1)
    expect(mockFetchCanDownload).toHaveBeenCalledTimes(1)
  })

  it('runs getServerUser and fetchUserCampaign concurrently', async () => {
    let campaignStartedWhileUserPending = false
    let userResolved = false
    mockGetServerUser.mockImplementation(() =>
      delay(null).then((v) => {
        userResolved = true
        return v
      }),
    )
    mockFetchUserCampaign.mockImplementation(() => {
      campaignStartedWhileUserPending = !userResolved
      return delay(proCampaign)
    })
    mockFetchCanDownload.mockResolvedValue(true)

    await Page()

    expect(campaignStartedWhileUserPending).toBe(true)
  })
})

describe('voter-records Page benchmark', () => {
  it('parallelized page is measurably faster than the serial baseline', async () => {
    mockGetServerUser.mockImplementation(() => delay({ id: 7 }))
    mockFetchUserCampaign.mockImplementation(() => delay(proCampaign))
    mockFetchCanDownload.mockImplementation(() => delay(true))

    const beforeStart = performance.now()
    await serialBaseline()
    const beforeMs = performance.now() - beforeStart

    const afterStart = performance.now()
    await Page()
    const afterMs = performance.now() - afterStart

    // eslint-disable-next-line no-console
    console.log(
      `[bench voter-records] before=${beforeMs.toFixed(1)}ms after=${afterMs.toFixed(1)}ms (latency ${LATENCY_MS}ms/call)`,
    )

    // BEFORE ~= sum of 3 serial calls (~3L); AFTER ~= max(user,campaign)+canDownload (~2L)
    expect(beforeMs).toBeGreaterThan(LATENCY_MS * 2.5)
    expect(afterMs).toBeLessThan(beforeMs)
    expect(beforeMs - afterMs).toBeGreaterThan(LATENCY_MS * 0.5)
  })
})

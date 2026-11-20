import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCandidateAccess, mockServerFetch, mockRedirect } = vi.hoisted(
  () => ({
    mockCandidateAccess: vi.fn(),
    mockServerFetch: vi.fn(),
    mockRedirect: vi.fn(),
  }),
)

vi.mock('../shared/candidateAccess', () => ({
  default: () => mockCandidateAccess(),
}))
vi.mock('gpApi/serverFetch', () => ({
  serverFetch: (...args: unknown[]) => mockServerFetch(...args),
}))
vi.mock('helpers/metadataHelper', () => ({ default: () => ({}) }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}))
vi.mock('./PlansPage', () => ({ default: () => null }))

import Page from './page'

describe('/dashboard/plans page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCandidateAccess.mockResolvedValue(undefined)
  })

  it('sends an elected official to the Serve dashboard', async () => {
    mockServerFetch.mockResolvedValue({ ok: true, data: { id: 'eo-1' } })

    await Page({ searchParams: Promise.resolve({}) })

    expect(mockRedirect).toHaveBeenCalledWith('/dashboard/chief-of-staff')
  })

  it('renders the plans page for a candidate', async () => {
    mockServerFetch.mockResolvedValue({ ok: false, status: 404 })

    await Page({ searchParams: Promise.resolve({}) })

    expect(mockRedirect).not.toHaveBeenCalled()
  })
})

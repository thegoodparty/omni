import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyElectedOffice } from 'gpApi/api-endpoints'
import ServeOnboardingPage from './page'

const { mockServerRequest, mockRedirect, mockOrganizations } = vi.hoisted(
  () => ({
    mockServerRequest: vi.fn(),
    mockRedirect: vi.fn(),
    mockOrganizations: vi.fn(),
  }),
)

vi.mock('gpApi/server-request', () => ({
  serverRequest: (...args: unknown[]) => mockServerRequest(...args),
}))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => mockRedirect(path),
}))

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => ({ value: 'campaign-7' }) }),
}))

vi.mock('helpers/authHelper', () => ({ requireAuth: () => undefined }))

vi.mock('helpers/getCurrentUserOrganizations', () => ({
  getCurrentUserOrganizations: () => mockOrganizations(),
}))

vi.mock('./ServeOnboardingFlow', () => ({
  default: () => <div data-testid="serve-onboarding-flow" />,
}))

const office = (overrides: Partial<MyElectedOffice> = {}): MyElectedOffice => ({
  id: 'eo-1',
  electedDate: null,
  swornInDate: null,
  termStartDate: null,
  termEndDate: null,
  termLengthDays: null,
  isActive: false,
  party: null,
  pledgedAt: null,
  onboardingCompletedAt: null,
  selfReported: false,
  onboardingStep: 'confirm',
  campaignId: 7,
  hasWinIssues: false,
  campaignWasEverPro: true,
  prepared: false,
  ...overrides,
})

// A prepared office has no result yet, so onboarding must not adopt it: the
// pledge refuses it, and reporting the result is what claims it.
describe('ServeOnboardingPage with an office prepared ahead of a result', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOrganizations.mockResolvedValue([])
    mockRedirect.mockImplementation((path: string) => {
      throw new Error(`redirect:${path}`)
    })
  })

  const mockResponses = (
    mine: MyElectedOffice[],
    current: MyElectedOffice | null = null,
  ) => {
    mockServerRequest.mockImplementation((endpoint: string) =>
      endpoint === 'GET /v1/elected-office/mine'
        ? { ok: true, data: mine }
        : { ok: current !== null, data: current },
    )
  }

  it('sends the holder to report the result when their only unfinished office is prepared', async () => {
    mockResponses([office({ prepared: true })])

    await expect(ServeOnboardingPage()).rejects.toThrow(
      'redirect:/dashboard/election-result',
    )
    expect(mockRedirect).toHaveBeenCalledExactlyOnceWith(
      '/dashboard/election-result',
    )
  })

  it('does not send the holder to report a result once the win claimed it', async () => {
    mockResponses([office({ prepared: false })])

    await expect(ServeOnboardingPage()).rejects.toThrow(
      'redirect:/post-auth-redirect',
    )
  })

  it('onboards a lead office alongside a prepared one', async () => {
    mockResponses([
      office({ id: 'eo-lead', campaignId: null }),
      office({ prepared: true }),
    ])

    await ServeOnboardingPage()

    expect(mockRedirect).not.toHaveBeenCalledWith('/dashboard/election-result')
  })
})

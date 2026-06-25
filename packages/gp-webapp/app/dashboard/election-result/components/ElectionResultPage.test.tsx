import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { router } from 'helpers/test-utils/router-mocking'
import ElectionResultPage from './ElectionResultPage'
import { updateCampaign } from 'app/onboarding/shared/ajaxActions'

const { mockErrorSnackbar, mockIsImpersonating, mockDismissElectionResult } =
  vi.hoisted(() => ({
    mockErrorSnackbar: vi.fn(),
    mockIsImpersonating: vi.fn(() => false),
    mockDismissElectionResult: vi.fn(),
  }))

vi.mock('app/onboarding/shared/ajaxActions', () => ({
  updateCampaign: vi.fn(),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ id: 1, details: { electionDate: '2025-05-20' } }],
}))

vi.mock('@shared/hooks/usePositionName', () => ({
  usePositionName: () => 'Mayor',
}))

vi.mock('@shared/hooks/useIsImpersonating', () => ({
  useIsImpersonating: () => mockIsImpersonating(),
}))

vi.mock('../dismissal', () => ({
  dismissElectionResult: mockDismissElectionResult,
}))

vi.mock('@shared/hooks/CampaignProvider', () => ({
  CAMPAIGN_QUERY_KEY: ['campaign'],
}))

const mockSetSelectedSlug = vi.fn()
vi.mock('@shared/organization-picker', () => ({
  ORGANIZATIONS_QUERY_KEY: ['organizations'],
  useSetOrganizationSlug: () => mockSetSelectedSlug,
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: mockErrorSnackbar }),
}))

// Keep the real term-date validation/format helpers, but replace the calendar
// picker UI (a react-day-picker popover that's impractical to drive in jsdom)
// with two buttons that set known-valid, non-overlapping dates.
vi.mock('app/serve/onboarding/termDates.shared', async () => {
  const actual = (await vi.importActual(
    'app/serve/onboarding/termDates.shared',
  )) as Record<string, unknown>
  return {
    ...actual,
    TermDatesFields: ({
      onStartChange,
      onEndChange,
    }: {
      onStartChange: (date: Date | undefined) => void
      onEndChange: (date: Date | undefined) => void
    }) => (
      <div>
        <button
          type="button"
          onClick={() => onStartChange(new Date(2027, 0, 1))}
        >
          set start
        </button>
        <button type="button" onClick={() => onEndChange(new Date(2031, 0, 1))}>
          set end
        </button>
      </div>
    ),
  }
})

vi.mock('helpers/analyticsHelper', () => ({
  EVENTS: {
    Candidacy: {
      DidYouWinModalCompleted: 'did_you_win_completed',
      DidYouWinModalViewed: 'did_you_win_viewed',
    },
  },
  trackEvent: vi.fn(),
}))

const mockUpdateCampaign = vi.mocked(updateCampaign)

const electedOfficeOrg = {
  slug: 'eo-1',
  name: null,
  positionName: null,
  position: null,
  district: null,
  electedOfficeId: 'eo-1',
  campaignId: null,
  status: 'active' as const,
}

const eoFixture = {
  id: 'eo-1',
  swornInDate: null,
  electedDate: null,
  termStartDate: '2027-01-01',
  termEndDate: '2031-01-01',
  termLengthDays: null,
  isActive: true,
  party: null,
  pledgedAt: null,
  onboardingCompletedAt: '2026-06-25T00:00:00.000Z',
  selfReported: false,
  onboardingStep: null,
  campaignId: 7,
}

// Set a valid, non-overlapping term via the mocked picker so "Continue" enables.
const enterTermDates = async (): Promise<void> => {
  await userEvent.click(
    await screen.findByRole('button', { name: 'set start' }),
  )
  await userEvent.click(screen.getByRole('button', { name: 'set end' }))
}

describe('ElectionResultPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsImpersonating.mockReturnValue(false)
    // The "I won" step loads the user's other offices to disable overlapping
    // ranges; default to none so a fresh winner can pick any dates.
    api.mock('GET /v1/elected-office/mine', { status: 200, data: [] })
  })

  it('lets an impersonating admin dismiss the gate without saving a result', () => {
    mockIsImpersonating.mockReturnValue(true)

    render(<ElectionResultPage />)

    expect(screen.getByText(/Impersonation mode/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(mockDismissElectionResult).toHaveBeenCalled()
    expect(router.push).toHaveBeenCalledWith('/dashboard')
    expect(mockUpdateCampaign).not.toHaveBeenCalled()
  })

  it('saves the loss result and routes to the loss flow without creating an office', async () => {
    mockUpdateCampaign.mockResolvedValue({ id: 1 } as never)

    let electedOfficeCreated = false
    api.mock('POST /v1/elected-office', () => {
      electedOfficeCreated = true
      return { status: 200, data: eoFixture }
    })

    render(<ElectionResultPage />)
    fireEvent.click(screen.getByRole('button', { name: 'I lost my race' }))

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith(
        '/dashboard/election-result/loss',
      )
    })
    expect(mockUpdateCampaign).toHaveBeenCalledWith([
      { key: 'details.wonGeneral', value: false },
    ])
    expect(electedOfficeCreated).toBe(false)
  })

  it('does not create an office until the win is confirmed with term dates', async () => {
    let electedOfficeCreated = false
    api.mock('POST /v1/elected-office', () => {
      electedOfficeCreated = true
      return { status: 200, data: eoFixture }
    })

    render(<ElectionResultPage />)
    fireEvent.click(screen.getByRole('button', { name: 'I won my race' }))

    // The term-dates step appears and nothing is persisted yet — clicking "I won"
    // alone must not create an office or save the result.
    expect(await screen.findByText('Congratulations!')).toBeInTheDocument()
    expect(mockUpdateCampaign).not.toHaveBeenCalled()
    expect(electedOfficeCreated).toBe(false)
  })

  it('does not create an office when saving the result fails on confirm', async () => {
    mockUpdateCampaign.mockResolvedValue(false)

    let electedOfficeCreated = false
    api.mock('POST /v1/elected-office', () => {
      electedOfficeCreated = true
      return { status: 200, data: eoFixture }
    })

    render(<ElectionResultPage />)
    fireEvent.click(screen.getByRole('button', { name: 'I won my race' }))
    await enterTermDates()
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(mockErrorSnackbar).toHaveBeenCalled()
    })
    expect(electedOfficeCreated).toBe(false)
  })

  it('creates an already-onboarded office with term dates when the win is confirmed', async () => {
    mockUpdateCampaign.mockResolvedValue({ id: 1 } as never)

    let createBody: unknown = null
    api.mock('POST /v1/elected-office', ({ body }) => {
      createBody = body
      return { status: 200, data: eoFixture }
    })
    api.mock('GET /v1/organizations', {
      status: 200,
      data: { organizations: [electedOfficeOrg] },
    })

    render(<ElectionResultPage />)
    fireEvent.click(screen.getByRole('button', { name: 'I won my race' }))
    await enterTermDates()
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith('/dashboard/briefings')
    })
    // The office is created already-onboarded (term dates + completion marker) so
    // post-auth routing keeps the just-won official on the dashboard.
    expect(createBody).toEqual(
      expect.objectContaining({
        termStartDate: '2027-01-01',
        termEndDate: '2031-01-01',
        onboardingCompletedAt: expect.any(String),
      }),
    )
    expect(mockUpdateCampaign).toHaveBeenCalledWith([
      { key: 'details.wonGeneral', value: true },
    ])
    expect(mockSetSelectedSlug).toHaveBeenCalledWith('eo-1')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import type { ElectedOffice } from 'gpApi/api-endpoints'

vi.mock('gpApi/typed-request', () => ({
  clientRequest: vi.fn(),
}))

vi.mock('@shared/sentry', () => ({
  reportErrorToSentry: vi.fn(),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn(), successSnackbar: vi.fn() }),
}))

let mockUserValue: [{ id: number } | null, () => void, boolean]
vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => mockUserValue,
}))

import { clientRequest } from 'gpApi/typed-request'
import { ElectedOfficeTermDatesModalController } from './ElectedOfficeTermDatesModalController'

const mockClientRequest = vi.mocked(clientRequest)
const TITLE = 'Add your term dates'

const office = (overrides: Partial<ElectedOffice>): ElectedOffice =>
  ({
    id: 'eo-1',
    swornInDate: null,
    electedDate: null,
    termStartDate: null,
    termEndDate: null,
    termLengthDays: null,
    isActive: false,
    party: null,
    pledgedAt: null,
    onboardingCompletedAt: null,
    ...overrides,
  }) as ElectedOffice

const mockMine = (offices: ElectedOffice[]): void => {
  mockClientRequest.mockResolvedValue({
    ok: true,
    status: 200,
    data: offices,
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUserValue = [{ id: 1 }, vi.fn(), false]
})

describe('ElectedOfficeTermDatesModalController', () => {
  const COMPLETED = '2026-02-01T00:00:00.000Z'

  it('prompts a settled (onboarding-complete) office missing term dates', async () => {
    mockMine([
      office({
        id: 'eo-1',
        onboardingCompletedAt: COMPLETED,
        termStartDate: null,
        termEndDate: null,
      }),
    ])

    render(<ElectedOfficeTermDatesModalController />)

    expect(await screen.findByText(TITLE)).toBeInTheDocument()
  })

  it('prompts a settled office when only one term bound is missing', async () => {
    mockMine([
      office({
        id: 'eo-1',
        onboardingCompletedAt: COMPLETED,
        termStartDate: '2025-01-01',
        termEndDate: null,
      }),
    ])

    render(<ElectedOfficeTermDatesModalController />)

    expect(await screen.findByText(TITLE)).toBeInTheDocument()
  })

  it('does not prompt a genuine serve lead still mid-onboarding (no campaign)', async () => {
    // A net-new serve lead (no campaign) that hasn't completed onboarding has no
    // term dates yet but supplies them via the onboarding term-dates step;
    // prompting here would block the dashboard / double-prompt mid-flow.
    mockMine([
      office({
        id: 'eo-1',
        onboardingCompletedAt: null,
        campaignId: null,
        termStartDate: null,
        termEndDate: null,
      }),
    ])

    render(<ElectedOfficeTermDatesModalController />)

    await waitFor(() => expect(mockClientRequest).toHaveBeenCalled())
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
  })

  it('prompts a win-origin office (campaign-created) missing dates even before onboarding completes', async () => {
    // A just-won official reached the dashboard without serve onboarding, so the
    // modal is their only term-date gap-filler. The campaignId marks win-origin.
    mockMine([
      office({
        id: 'eo-1',
        onboardingCompletedAt: null,
        campaignId: 7,
        termStartDate: null,
        termEndDate: null,
      }),
    ])

    render(<ElectedOfficeTermDatesModalController />)

    expect(await screen.findByText(TITLE)).toBeInTheDocument()
  })

  it('does not prompt when a settled office already has both term dates', async () => {
    mockMine([
      office({
        id: 'eo-1',
        onboardingCompletedAt: COMPLETED,
        termStartDate: '2025-01-01',
        termEndDate: '2029-01-01',
      }),
    ])

    render(<ElectedOfficeTermDatesModalController />)

    await waitFor(() => expect(mockClientRequest).toHaveBeenCalled())
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
  })

  it('does not prompt a non-elected-office user (no offices)', async () => {
    mockMine([])

    render(<ElectedOfficeTermDatesModalController />)

    await waitFor(() => expect(mockClientRequest).toHaveBeenCalled())
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
  })

  it('does not fetch or prompt while the user is still loading', () => {
    mockUserValue = [null, vi.fn(), true]

    render(<ElectedOfficeTermDatesModalController />)

    expect(mockClientRequest).not.toHaveBeenCalled()
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
  })
})

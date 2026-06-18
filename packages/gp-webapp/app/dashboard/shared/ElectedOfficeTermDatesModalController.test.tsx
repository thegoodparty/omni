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
  it('prompts an elected official whose office is missing term dates', async () => {
    mockMine([office({ id: 'eo-1', termStartDate: null, termEndDate: null })])

    render(<ElectedOfficeTermDatesModalController />)

    expect(await screen.findByText(TITLE)).toBeInTheDocument()
  })

  it('prompts when only one term bound is missing', async () => {
    mockMine([
      office({ id: 'eo-1', termStartDate: '2025-01-01', termEndDate: null }),
    ])

    render(<ElectedOfficeTermDatesModalController />)

    expect(await screen.findByText(TITLE)).toBeInTheDocument()
  })

  it('does not prompt when the office already has both term dates', async () => {
    mockMine([
      office({
        id: 'eo-1',
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

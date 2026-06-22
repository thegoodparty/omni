import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import type { ElectedOffice } from 'gpApi/api-endpoints'

vi.mock('gpApi/typed-request', () => ({
  clientRequest: vi.fn(),
}))

vi.mock('@shared/sentry', () => ({
  reportErrorToSentry: vi.fn(),
}))

const errorSnackbar = vi.fn()
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar, successSnackbar: vi.fn() }),
}))

import { clientRequest } from 'gpApi/typed-request'
import { ElectedOfficeTermDatesModal } from './ElectedOfficeTermDatesModal'

const mockClientRequest = vi.mocked(clientRequest)

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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ElectedOfficeTermDatesModal', () => {
  it('PUTs the term dates and calls onSaved on success', async () => {
    mockClientRequest.mockResolvedValue({ ok: true, status: 200 } as never)
    const onSaved = vi.fn()

    // Both bounds present and valid → Save is enabled immediately, so the test
    // exercises the submit path without driving the calendar UI.
    render(
      <ElectedOfficeTermDatesModal
        office={office({
          id: 'eo-7',
          termStartDate: '2025-01-01',
          termEndDate: '2029-01-01',
        })}
        otherRanges={[]}
        onSaved={onSaved}
        onDismiss={vi.fn()}
      />,
    )

    await userEvent.click(
      screen.getByRole('button', { name: 'Save term dates' }),
    )

    await waitFor(() => {
      expect(mockClientRequest).toHaveBeenCalledWith(
        'PUT /v1/elected-office/:id',
        {
          id: 'eo-7',
          termStartDate: '2025-01-01',
          termEndDate: '2029-01-01',
        },
      )
    })
    expect(onSaved).toHaveBeenCalled()
  })

  it('disables Save until both dates are present', () => {
    render(
      <ElectedOfficeTermDatesModal
        office={office({ id: 'eo-7', termStartDate: '2025-01-01' })}
        otherRanges={[]}
        onSaved={vi.fn()}
        onDismiss={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Save term dates' }),
    ).toBeDisabled()
  })

  it('surfaces an error and does not call onSaved when the PUT fails', async () => {
    mockClientRequest.mockResolvedValue({ ok: false, status: 500 } as never)
    const onSaved = vi.fn()

    render(
      <ElectedOfficeTermDatesModal
        office={office({
          id: 'eo-7',
          termStartDate: '2025-01-01',
          termEndDate: '2029-01-01',
        })}
        otherRanges={[]}
        onSaved={onSaved}
        onDismiss={vi.fn()}
      />,
    )

    await userEvent.click(
      screen.getByRole('button', { name: 'Save term dates' }),
    )

    await waitFor(() => expect(errorSnackbar).toHaveBeenCalled())
    expect(onSaved).not.toHaveBeenCalled()
  })
})

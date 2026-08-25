import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { OutreachDetailsDrawer } from './OutreachDetailsDrawer'
import type { HistoryRow } from './historyStatus.util'

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(useSnackbar).mockReturnValue({
    displaySnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    successSnackbar: vi.fn(),
  })
})

const baseDetail = {
  id: 30,
  createdAt: new Date('2026-08-10T00:00:00Z'),
  updatedAt: new Date('2026-08-10T00:00:00Z'),
  campaignId: 1,
  outreachType: 'nativePhoneBanking' as const,
  projectId: null,
  name: 'GOTV calls',
  error: null,
  audienceRequest: null,
  script: null,
  message: null,
  date: null,
  imageUrl: null,
  voterFileFilterId: null,
  doorKnockingRouteId: null,
  phoneListId: null,
  identityId: null,
  didState: null,
  didNpaSubset: [],
  title: null,
  textCount: null,
  billableTextCount: null,
  campaignPlanDueDate: null,
  organizationSlug: null,
  archivedAt: null,
}

const inProgressRow: HistoryRow = {
  id: 30,
  createdAt: '2026-08-10T00:00:00Z',
  outreachType: 'nativePhoneBanking',
  name: 'GOTV calls',
  status: 'in_progress',
}

const completedRow: HistoryRow = {
  ...inProgressRow,
  status: 'completed',
}

// The list endpoint joins the whole VoterFileFilter row onto each envelope, so
// a history row carries the saved list's name alongside its criteria flags.
const rowWithFilter = (voterFileFilter: Record<string, unknown>): HistoryRow =>
  ({ ...inProgressRow, voterFileFilter }) as HistoryRow

describe('OutreachDetailsDrawer — applied filters', () => {
  const mockDetail = () =>
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: { ...baseDetail, status: 'in_progress' as const },
    })

  it('renders the saved list as an Audience pill alongside the Filters pills', async () => {
    mockDetail()

    render(
      <OutreachDetailsDrawer
        row={rowWithFilter({ name: 'Renters in 98103', age50Plus: true })}
        onOpenChange={vi.fn()}
      />,
    )

    expect(await screen.findByText('Applied filters')).toBeInTheDocument()
    expect(screen.getByText('Audience')).toBeInTheDocument()
    expect(screen.getByText('Renters in 98103')).toBeInTheDocument()
    expect(screen.getByText('Filters')).toBeInTheDocument()
  })

  it('drops the Audience group for a row with no saved list, keeping Filters', async () => {
    mockDetail()

    render(
      <OutreachDetailsDrawer
        row={rowWithFilter({ age50Plus: true })}
        onOpenChange={vi.fn()}
      />,
    )

    expect(await screen.findByText('Applied filters')).toBeInTheDocument()
    expect(screen.getByText('Filters')).toBeInTheDocument()
    expect(screen.queryByText('Audience')).not.toBeInTheDocument()
  })

  it('hides the whole section when the row has neither a list nor filters', async () => {
    mockDetail()

    render(<OutreachDetailsDrawer row={inProgressRow} onOpenChange={vi.fn()} />)

    expect(await screen.findByText('Overview')).toBeInTheDocument()
    expect(screen.queryByText('Applied filters')).not.toBeInTheDocument()
  })
})

describe('OutreachDetailsDrawer — phone banking', () => {
  it('renders the in-progress section order, progress math, and the Continue calling footer', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: {
        ...baseDetail,
        status: 'in_progress',
        phoneBankingListId: 5,
        phoneBanking: {
          listId: 5,
          entriesTotal: 200,
          entriesCalled: 92,
          peopleTotal: 480,
          peopleCalled: 92,
          byOutcome: {
            answered: 60,
            no_answer: 20,
            voicemail: 8,
            wrong_number: 3,
            refused: 1,
          },
          supporters: 30,
          unsure: 10,
          nonSupporters: 20,
        },
      },
    })

    render(<OutreachDetailsDrawer row={inProgressRow} onOpenChange={vi.fn()} />)

    expect(await screen.findByText('92 of 480 reached')).toBeInTheDocument()
    // Design-canvas progress card shows the rounded percentage on the right.
    expect(screen.getByText('19%')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('Remaining')).toBeInTheDocument()
    // peopleTotal - peopleCalled = 388
    expect(screen.getByText('388')).toBeInTheDocument()
    expect(screen.getByText('Free')).toBeInTheDocument()

    const cta = screen.getByRole('link', { name: 'Continue calling' })
    expect(cta).toHaveAttribute('href', '/dashboard/outreach/phone-banking/5')

    // In-progress drawer never shows the completed results table or Delete.
    expect(screen.queryByText(/Results/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Delete' }),
    ).not.toBeInTheDocument()
  })

  it('renders the completed results breakdown with percents and the Delete + Move to archive footer', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: {
        ...baseDetail,
        status: 'completed',
        phoneBankingListId: 5,
        phoneBanking: {
          listId: 5,
          entriesTotal: 10,
          entriesCalled: 10,
          peopleTotal: 16,
          peopleCalled: 16,
          byOutcome: {
            answered: 5,
            no_answer: 5,
            voicemail: 0,
            wrong_number: 0,
            refused: 0,
          },
          supporters: 8,
          unsure: 4,
          nonSupporters: 4,
        },
      },
    })

    render(<OutreachDetailsDrawer row={completedRow} onOpenChange={vi.fn()} />)

    expect(
      await screen.findByText('Based on 10 phone banking contacts'),
    ).toBeInTheDocument()
    expect(screen.getByText('Answered')).toBeInTheDocument()
    expect(screen.getByText('Refused to engage')).toBeInTheDocument()
    // Answered: 5 of 10 entriesCalled = 50%
    expect(screen.getAllByText('50%').length).toBeGreaterThan(0)
    expect(screen.getByText('Support: Yes')).toBeInTheDocument()
    expect(screen.getByText('Support: Unsure')).toBeInTheDocument()
    expect(screen.getByText('Support: No')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Move to archive' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Continue calling' }),
    ).not.toBeInTheDocument()
  })

  it('shows Restore from archive for an already-archived completed row and fires the archive endpoint with archived: false', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: {
        ...baseDetail,
        status: 'completed',
        phoneBankingListId: 5,
        archivedAt: new Date('2026-08-15T00:00:00Z'),
        phoneBanking: {
          listId: 5,
          entriesTotal: 10,
          entriesCalled: 10,
          peopleTotal: 16,
          peopleCalled: 16,
          byOutcome: {
            answered: 10,
            no_answer: 0,
            voicemail: 0,
            wrong_number: 0,
            refused: 0,
          },
          supporters: 16,
          unsure: 0,
          nonSupporters: 0,
        },
      },
    })
    let archiveBody: unknown
    api.mock('PATCH /v1/outreach/:id/archive', ({ params, body }) => {
      archiveBody = body
      expect(params.id).toBe('30')
      return { status: 200, data: { id: 30, archivedAt: null } }
    })

    const archivedRow: HistoryRow = {
      ...completedRow,
      archivedAt: '2026-08-15T00:00:00Z',
    }
    const onOpenChange = vi.fn()
    render(
      <OutreachDetailsDrawer row={archivedRow} onOpenChange={onOpenChange} />,
    )

    const restoreButton = await screen.findByRole('button', {
      name: 'Restore from archive',
    })
    await userEvent.click(restoreButton)

    expect(archiveBody).toEqual({ archived: false })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('archives a completed row and updates it in context', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: {
        ...baseDetail,
        status: 'completed',
        phoneBankingListId: 5,
        phoneBanking: {
          listId: 5,
          entriesTotal: 10,
          entriesCalled: 10,
          peopleTotal: 16,
          peopleCalled: 16,
          byOutcome: {
            answered: 10,
            no_answer: 0,
            voicemail: 0,
            wrong_number: 0,
            refused: 0,
          },
          supporters: 16,
          unsure: 0,
          nonSupporters: 0,
        },
      },
    })
    let archiveBody: unknown
    api.mock('PATCH /v1/outreach/:id/archive', ({ params, body }) => {
      archiveBody = body
      expect(params.id).toBe('30')
      return {
        status: 200,
        data: { id: 30, archivedAt: new Date('2026-08-20T00:00:00Z') },
      }
    })

    const onOpenChange = vi.fn()
    render(
      <OutreachDetailsDrawer row={completedRow} onOpenChange={onOpenChange} />,
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'Move to archive' }),
    )

    expect(archiveBody).toEqual({ archived: true })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('a completed non-phone-banking row gets Move to archive but no Delete', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: {
        ...baseDetail,
        outreachType: 'robocall',
        status: 'completed',
      },
    })

    const robocallRow: HistoryRow = {
      id: 30,
      createdAt: '2026-08-10T00:00:00Z',
      outreachType: 'robocall',
      name: 'Budget hearing reminder',
      status: 'completed',
    }
    render(<OutreachDetailsDrawer row={robocallRow} onOpenChange={vi.fn()} />)

    expect(
      await screen.findByRole('button', { name: 'Move to archive' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Delete' }),
    ).not.toBeInTheDocument()
  })

  it('confirms before deleting and calls the delete endpoint', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: {
        ...baseDetail,
        status: 'completed',
        phoneBankingListId: 5,
        phoneBanking: {
          listId: 5,
          entriesTotal: 10,
          entriesCalled: 10,
          peopleTotal: 16,
          peopleCalled: 16,
          byOutcome: {
            answered: 10,
            no_answer: 0,
            voicemail: 0,
            wrong_number: 0,
            refused: 0,
          },
          supporters: 16,
          unsure: 0,
          nonSupporters: 0,
        },
      },
    })
    let deleteCalled = false
    api.mock('DELETE /v1/phone-banking/lists/:id', ({ params }) => {
      deleteCalled = true
      expect(params.id).toBe('5')
      return { status: 200, data: undefined }
    })

    const onOpenChange = vi.fn()
    render(
      <OutreachDetailsDrawer row={completedRow} onOpenChange={onOpenChange} />,
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete' }),
    )

    expect(deleteCalled).toBe(true)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('OutreachDetailsDrawer — cancel before send', () => {
  const scheduledSmsRow: HistoryRow = {
    id: 41,
    createdAt: '2026-08-20T00:00:00Z',
    outreachType: 'p2p',
    name: 'Likely voters — SMS',
    status: 'pending',
    phoneListId: 9,
  }
  const smsDetail = {
    ...baseDetail,
    id: 41,
    outreachType: 'p2p' as const,
    name: 'Likely voters — SMS',
    status: 'pending' as const,
    phoneListId: 9,
  }
  // Cleared compliance keeps the shipped Cancel campaign footer; omitting it
  // reads as verification-pending and swaps to Delete + Start verification.
  const verifiedCompliance = {
    peerlyCvStatus: 'VERIFIED',
  } as React.ComponentProps<typeof OutreachDetailsDrawer>['tcrCompliance']
  const mockNoReceipt = () =>
    api.mock('GET /v1/outreach/:id/receipt', {
      status: 404,
      data: { message: 'No receipt' },
    })

  it('confirms, cancels, updates the row, and notes the refund', async () => {
    mockNoReceipt()
    const successSnackbar = vi.fn()
    vi.mocked(useSnackbar).mockReturnValue({
      displaySnackbar: vi.fn(),
      errorSnackbar: vi.fn(),
      successSnackbar,
    })
    api.mock('GET /v1/outreach/:id', { status: 200, data: smsDetail })
    let cancelParams: unknown
    api.mock('POST /v1/outreach/:id/cancel', ({ params }) => {
      cancelParams = params
      return {
        status: 200,
        data: {
          outreach: { ...smsDetail, status: 'canceled' },
          refunded: true,
        },
      }
    })

    const onOpenChange = vi.fn()
    render(
      <OutreachDetailsDrawer
        row={scheduledSmsRow}
        onOpenChange={onOpenChange}
        tcrCompliance={verifiedCompliance}
      />,
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'Cancel campaign' }),
    )
    expect(await screen.findByText('Cancel this campaign?')).toBeInTheDocument()

    // The dialog's destructive action shares the trigger's name.
    const dialogButtons = screen.getAllByRole('button', {
      name: 'Cancel campaign',
    })
    await userEvent.click(
      dialogButtons[dialogButtons.length - 1] as HTMLElement,
    )

    expect(cancelParams).toEqual({ id: '41' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(successSnackbar).toHaveBeenCalledWith(
      'Campaign canceled. Your refund will arrive in 5-10 business days.',
    )
  })

  it('offers no cancel action on a completed row', async () => {
    mockNoReceipt()
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: { ...smsDetail, status: 'completed' },
    })
    render(
      <OutreachDetailsDrawer
        row={{ ...scheduledSmsRow, status: 'completed' }}
        onOpenChange={vi.fn()}
        tcrCompliance={verifiedCompliance}
      />,
    )
    expect(
      (await screen.findAllByText('Likely voters — SMS')).length,
    ).toBeGreaterThan(0)
    expect(
      screen.queryByRole('button', { name: 'Cancel campaign' }),
    ).not.toBeInTheDocument()
  })

  it('flags a scheduled SMS row as Will not send while verification pends, with Delete + Start verification', async () => {
    mockNoReceipt()
    api.mock('GET /v1/outreach/:id', { status: 200, data: smsDetail })
    let cancelParams: unknown
    api.mock('POST /v1/outreach/:id/cancel', ({ params }) => {
      cancelParams = params
      return {
        status: 200,
        data: {
          outreach: { ...smsDetail, status: 'canceled' },
          refunded: true,
        },
      }
    })

    const onOpenChange = vi.fn()
    render(
      <OutreachDetailsDrawer
        row={scheduledSmsRow}
        onOpenChange={onOpenChange}
      />,
    )

    expect(await screen.findByText('Will not send')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Cancel campaign' }),
    ).not.toBeInTheDocument()

    // Delete rides the same cancel confirm + endpoint as Cancel campaign.
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Cancel this campaign?')).toBeInTheDocument()
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Cancel campaign',
      }),
    )
    expect(cancelParams).toEqual({ id: '41' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('routes Start verification to the election-filing entry when no TCR record exists', async () => {
    mockNoReceipt()
    api.mock('GET /v1/outreach/:id', { status: 200, data: smsDetail })
    const { router } = await import('helpers/test-utils/router-mocking')

    const onOpenChange = vi.fn()
    render(
      <OutreachDetailsDrawer
        row={scheduledSmsRow}
        onOpenChange={onOpenChange}
      />,
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'Start verification' }),
    )
    expect(router.push).toHaveBeenCalledWith(
      '/dashboard/profile/texting-compliance/election-filing',
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows View receipt when the receipt endpoint returns one, opening it in a new tab', async () => {
    api.mock('GET /v1/outreach/:id', { status: 200, data: smsDetail })
    api.mock('GET /v1/outreach/:id/receipt', {
      status: 200,
      data: {
        amount: 42,
        cardBrand: 'visa',
        cardLast4: '4242',
        receiptUrl: 'https://pay.stripe.com/receipts/rcpt_1',
        paidAt: '2026-08-24T12:00:00.000Z',
      },
    })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)

    render(
      <OutreachDetailsDrawer
        row={scheduledSmsRow}
        onOpenChange={vi.fn()}
        tcrCompliance={verifiedCompliance}
      />,
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'View receipt' }),
    )
    expect(open).toHaveBeenCalledWith(
      'https://pay.stripe.com/receipts/rcpt_1',
      '_blank',
      'noopener',
    )
    open.mockRestore()
  })
})

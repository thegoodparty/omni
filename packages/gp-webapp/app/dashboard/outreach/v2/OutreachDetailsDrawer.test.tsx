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

  // The href is the phone list's id, which rides the detail rather than the
  // history row, so it is unknown for as long as that query is in flight. The
  // footer holds the slot instead of arriving a beat late under a thumb that
  // is already moving.
  it('holds the Continue calling slot while the detail is still loading', async () => {
    // Never resolves, so the drawer stays in the state this is about for the
    // length of the test rather than racing the assertion.
    api.mock('GET /v1/outreach/:id', () => new Promise<never>(() => undefined))

    render(<OutreachDetailsDrawer row={inProgressRow} onOpenChange={vi.fn()} />)

    const cta = await screen.findByRole('button', { name: 'Continue calling' })
    expect(cta).toBeDisabled()
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

// Door knocking arrived in this table as its own channel in #1374, and until
// now its rows opened a drawer built for envelopes that carry their own
// figures. These are the three things that had to be true for a walk to read
// correctly in a campaign-reporting surface.
describe('OutreachDetailsDrawer — door knocking', () => {
  const doorKnockingDetail = (status: 'in_progress' | 'completed') => ({
    ...baseDetail,
    outreachType: 'nativeDoorKnocking' as const,
    name: 'Elm St & 5th',
    status,
    doorKnockingRouteId: 7,
  })

  const doorKnockingRow = (
    status: 'in_progress' | 'completed',
  ): HistoryRow => ({
    id: 30,
    createdAt: '2026-08-10T00:00:00Z',
    outreachType: 'nativeDoorKnocking',
    name: 'Elm St & 5th',
    status,
  })

  // The phone-banking precedent, in door knocking's verb. The link is the
  // surface rather than the list, because this row knows its route id and
  // nothing maps that back to the turf a deeper link would need.
  it('offers Continue knocking on an in-progress walk', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: doorKnockingDetail('in_progress'),
    })

    render(
      <OutreachDetailsDrawer
        row={doorKnockingRow('in_progress')}
        onOpenChange={vi.fn()}
      />,
    )

    const cta = await screen.findByRole('link', { name: 'Continue knocking' })
    expect(cta).toHaveAttribute('href', '/dashboard/door-knocking')
    expect(
      screen.queryByRole('link', { name: 'Continue calling' }),
    ).not.toBeInTheDocument()
  })

  // The archive seam. Two rows carry an archivedAt for one walk, and only the
  // door-knocking surface can write both — a button here could reach the
  // envelope alone, which is precisely how they come apart. So the drawer says
  // where the action lives instead of offering half of it.
  it('sends archive back to the door-knocking surface on a finished walk', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: doorKnockingDetail('completed'),
    })

    render(
      <OutreachDetailsDrawer
        row={doorKnockingRow('completed')}
        onOpenChange={vi.fn()}
      />,
    )

    expect(
      await screen.findByText(/Archive this from Door knocking/),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Move to archive' }),
    ).not.toBeInTheDocument()
  })

  // The envelope holds the route's id and nothing else about the walk, so a
  // People cell here could only ever say "—". Naming where the figures live
  // beats printing an empty one.
  it('points at the list for the figures it does not hold', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: doorKnockingDetail('in_progress'),
    })

    render(
      <OutreachDetailsDrawer
        row={doorKnockingRow('in_progress')}
        onOpenChange={vi.fn()}
      />,
    )

    expect(await screen.findByText('Overview')).toBeInTheDocument()
    expect(screen.queryByText('People')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        /knocking progress for this walk are on the list itself/,
      ),
    ).toBeInTheDocument()
  })
})

// The canvas's fourth footer mode, which no channel had ported. A paid
// campaign is sent by Peerly on a schedule we bought; there is no edit
// endpoint, no delete endpoint and nothing to drive, so the footer says the
// campaign needs nothing rather than rendering buttons that cannot work.
describe('OutreachDetailsDrawer — automatic campaigns', () => {
  it('tells a scheduled paid campaign it is sending automatically', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: { ...baseDetail, outreachType: 'text' as const, status: 'paid' },
    })

    const scheduledText: HistoryRow = {
      id: 30,
      createdAt: '2026-08-10T00:00:00Z',
      outreachType: 'text',
      name: 'Election day reminder',
      status: 'paid',
    }
    render(<OutreachDetailsDrawer row={scheduledText} onOpenChange={vi.fn()} />)

    expect(await screen.findByText(/sending automatically/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Move to archive' }),
    ).not.toBeInTheDocument()
  })

  // Draft and In review have no canvas position at all: nothing to continue,
  // nothing to archive, and nothing automatic to promise.
  it('leaves a draft with no footer', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: { ...baseDetail, outreachType: 'text' as const, status: 'pending' },
    })

    const draft: HistoryRow = {
      id: 30,
      createdAt: '2026-08-10T00:00:00Z',
      outreachType: 'text',
      name: 'Untitled',
      status: 'pending',
      phoneListId: 9,
    }
    render(<OutreachDetailsDrawer row={draft} onOpenChange={vi.fn()} />)

    expect(await screen.findByText('Overview')).toBeInTheDocument()
    expect(screen.queryByText(/sending automatically/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Move to archive' }),
    ).not.toBeInTheDocument()
  })
})

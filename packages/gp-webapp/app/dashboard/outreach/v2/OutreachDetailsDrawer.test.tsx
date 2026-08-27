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
            disconnected: 0,
            hung_up: 0,
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

  // A detail that failed has no list id, so there is no CTA to enable — and a
  // button that can never enable is not a state to render. The recovery lives
  // in the body instead, which is why the two are asserted together: dropping
  // the message would leave the missing footer unexplained.
  it('explains a failed detail in the body rather than holding a dead CTA', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 500,
      data: undefined as never,
    })

    render(<OutreachDetailsDrawer row={inProgressRow} onOpenChange={vi.fn()} />)

    expect(
      await screen.findByText(/couldn't load this campaign's call progress/),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Continue calling' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Continue calling' }),
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
            disconnected: 0,
            hung_up: 0,
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
    expect(screen.getByText('Refused')).toBeInTheDocument()
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
            disconnected: 0,
            hung_up: 0,
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
            disconnected: 0,
            hung_up: 0,
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
            disconnected: 0,
            hung_up: 0,
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

// Door knocking arrived in this table as its own channel in #1374, and its
// rows opened a drawer built for envelopes that carry their own figures — a
// walk's live on the turf the other side of its route. The detail's
// `doorKnocking` block is that hop, and these are the things that had to be
// true for a walk to read like its peers on a campaign-reporting surface.
describe('OutreachDetailsDrawer — door knocking', () => {
  // Doors and people are two numbers, and both come from the rail's own counts
  // aggregate: 4 doors holding 9 knockable people, 6 of them logged.
  const doorKnockingBlock = {
    turfId: 12,
    routeId: 7,
    turfName: 'Elm St & 5th',
    doorCount: 4,
    peopleCount: 9,
    loggedCount: 6,
    completedAt: null,
    archivedAt: null,
  }

  // `null` rather than `undefined` for "no block": an explicit `undefined`
  // argument takes the default, which would silently send the block anyway.
  const doorKnockingDetail = (
    status: 'in_progress' | 'completed',
    doorKnocking: typeof doorKnockingBlock | null = doorKnockingBlock,
  ) => ({
    ...baseDetail,
    outreachType: 'nativeDoorKnocking' as const,
    name: 'Elm St & 5th',
    status,
    doorKnockingRouteId: 7,
    doorKnocking: doorKnocking ?? undefined,
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

  // The phone-banking precedent, in door knocking's verb. Still the surface
  // rather than the list: the turf id is on the detail now, but the
  // door-knocking page reads no such param, so a deeper link would land here
  // anyway.
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

  it('renders doors, people and logged progress from the block', async () => {
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

    // The Doors/People labels render while the detail is still in flight, so
    // waiting on one of them would assert against the skeleton. The progress
    // line only exists once the block has landed.
    // "Logged", never "reached": three of the outcomes behind this number are
    // doors where nobody spoke to anybody.
    expect(await screen.findByText('6 of 9 people logged')).toBeInTheDocument()
    expect(screen.getByText('Doors')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('People')).toBeInTheDocument()
    expect(screen.getByText('67%')).toBeInTheDocument()
    expect(screen.getByText('Remaining')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  // A finished walk keeps its progress rather than swapping it for a Results
  // table, because door knocking has no outcomes surface here (ADR 0012) and a
  // walk is routinely ended with doors left unlogged.
  it('keeps the progress section on a finished walk', async () => {
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

    expect(await screen.findByText('6 of 9 people logged')).toBeInTheDocument()
  })

  // The archive seam. Two rows carry an archivedAt for one walk, and only the
  // TURF's endpoint writes both — so the drawer gets the same button every
  // other finished row has, pointed at the one writer rather than at this
  // envelope's own archive route.
  it('archives a finished walk through the turf endpoint, not the envelope', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: doorKnockingDetail('completed'),
    })
    let turfArchiveBody: unknown
    let turfArchiveId: string | undefined
    api.mock('POST /v1/door-knocking/turfs/:id/archive', ({ params, body }) => {
      turfArchiveId = params.id
      turfArchiveBody = body
      return {
        status: 200,
        data: {
          ...doorKnockingBlock,
          archivedAt: new Date('2026-08-20T00:00:00Z'),
        } as never,
      }
    })
    let envelopeArchiveCalled = false
    api.mock('PATCH /v1/outreach/:id/archive', () => {
      envelopeArchiveCalled = true
      return { status: 200, data: { id: 30, archivedAt: null } }
    })

    const onOpenChange = vi.fn()
    render(
      <OutreachDetailsDrawer
        row={doorKnockingRow('completed')}
        onOpenChange={onOpenChange}
      />,
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'Move to archive' }),
    )

    // The TURF's id, not the envelope's — the two are different numbers here
    // precisely so a mix-up cannot pass.
    expect(turfArchiveId).toBe('12')
    expect(turfArchiveBody).toEqual({ archived: true })
    expect(envelopeArchiveCalled).toBe(false)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(
      screen.getByText(/This archives the saved list too/),
    ).toBeInTheDocument()
  })

  // The drift this block exists to read past: the turf was archived before the
  // envelope mirror shipped, so the envelope still reads active. The source is
  // the turf, so the button must offer Restore rather than a second archive.
  it('reads archived state off the turf, not the envelope mirror', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: doorKnockingDetail('completed', {
        ...doorKnockingBlock,
        archivedAt: new Date('2026-08-15T00:00:00Z') as never,
      }),
    })
    let turfArchiveBody: unknown
    api.mock('POST /v1/door-knocking/turfs/:id/archive', ({ body }) => {
      turfArchiveBody = body
      return { status: 200, data: { ...doorKnockingBlock } as never }
    })

    render(
      <OutreachDetailsDrawer
        row={doorKnockingRow('completed')}
        onOpenChange={vi.fn()}
      />,
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'Restore from archive' }),
    )
    expect(turfArchiveBody).toEqual({ archived: false })
  })

  // A tombstoned list leaves the envelope and its paid route standing with
  // nothing to describe. That is the one case the old id-only rendering was
  // right about, and it keeps it — including no archive button, since there is
  // no turf left to write.
  it('says so when the walk has no list left to report on', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: doorKnockingDetail('completed', null),
    })

    render(
      <OutreachDetailsDrawer
        row={doorKnockingRow('completed')}
        onOpenChange={vi.fn()}
      />,
    )

    expect(
      await screen.findByText(/saved list is no longer available/),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Move to archive' }),
    ).not.toBeInTheDocument()
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
  // nothing to archive, and nothing automatic to promise. No phone list on
  // purpose: a pending row WITH one is the cancel-before-send set, which
  // carries the Cancel footer covered below.
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
    }
    render(<OutreachDetailsDrawer row={draft} onOpenChange={vi.fn()} />)

    expect(await screen.findByText('Overview')).toBeInTheDocument()
    expect(screen.queryByText(/sending automatically/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Move to archive' }),
    ).not.toBeInTheDocument()
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

  it('flags a scheduled SMS row as Needs compliance while verification pends, with Cancel + Start verification', async () => {
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

    expect(await screen.findByText('Needs compliance')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Cancel campaign' }),
    ).not.toBeInTheDocument()

    // Cancel rides the same confirm + endpoint as Cancel campaign.
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Cancel this campaign?')).toBeInTheDocument()
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Cancel campaign',
      }),
    )
    expect(cancelParams).toEqual({ id: '41' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows an error state instead of a computed amount when the receipt read fails', async () => {
    api.mock('GET /v1/outreach/:id', { status: 200, data: smsDetail })
    // 500, not 502: the mocker's error union stops at 500, and the drawer
    // treats every non-404 failure the same way.
    api.mock('GET /v1/outreach/:id/receipt', {
      status: 500,
      data: { message: 'Stripe unreachable' },
    })

    render(
      <OutreachDetailsDrawer row={scheduledSmsRow} onOpenChange={vi.fn()} />,
    )

    expect(
      await screen.findByText(/couldn't load the payment details/),
    ).toBeInTheDocument()
    expect(screen.queryByText('Total cost')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'View receipt' }),
    ).not.toBeInTheDocument()
  })

  it('offers Move to archive on a canceled row — history is never hard-deleted', async () => {
    mockNoReceipt()
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: { ...smsDetail, status: 'canceled' },
    })
    let archiveBody: unknown
    api.mock('PATCH /v1/outreach/:id/archive', ({ body }) => {
      archiveBody = body
      return {
        status: 200,
        data: { id: 41, archivedAt: new Date('2026-08-27T00:00:00Z') },
      }
    })

    const onOpenChange = vi.fn()
    render(
      <OutreachDetailsDrawer
        row={{ ...scheduledSmsRow, status: 'canceled' }}
        onOpenChange={onOpenChange}
      />,
    )

    expect(
      screen.queryByRole('button', { name: 'Cancel campaign' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Delete' }),
    ).not.toBeInTheDocument()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Move to archive' }),
    )
    expect(archiveBody).toEqual({ archived: true })
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

  it('shows Payment details from the receipt with View receipt opening in a new tab', async () => {
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

    // The receipt amount is the charge of record, in dollars.
    expect(await screen.findByText('$42.00')).toBeInTheDocument()
    expect(screen.getByText('Payment details')).toBeInTheDocument()
    expect(screen.getByText('Cost per outreach')).toBeInTheDocument()
    expect(screen.getByText('$0.035')).toBeInTheDocument()
    expect(screen.getByText('Unsubscribes')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'View receipt' }))
    expect(open).toHaveBeenCalledWith(
      'https://pay.stripe.com/receipts/rcpt_1',
      '_blank',
      'noopener',
    )
    open.mockRestore()
  })

  it('reads Free with no receipt and renders the composed script verbatim', async () => {
    mockNoReceipt()
    api.mock('GET /v1/outreach/:id', { status: 200, data: smsDetail })

    const script =
      'Hello {first_name}, this is Ada, candidate for City Council.\nReply STOP to opt out.'
    render(
      <OutreachDetailsDrawer
        row={{ ...scheduledSmsRow, script }}
        onOpenChange={vi.fn()}
        tcrCompliance={verifiedCompliance}
      />,
    )

    // No receipt + no billable count = a fully free send.
    expect(await screen.findByText('Free')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'View receipt' }),
    ).not.toBeInTheDocument()

    expect(screen.getByText('Message')).toBeInTheDocument()
    // Line breaks survive: the script renders as one pre-wrap block, not
    // re-composed copy.
    expect(
      screen.getByText((_, el) => el?.textContent === script, {
        selector: 'p',
      }),
    ).toBeInTheDocument()
  })
})

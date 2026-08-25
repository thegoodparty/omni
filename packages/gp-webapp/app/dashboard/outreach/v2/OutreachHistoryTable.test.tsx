import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { OutreachHistoryTable } from './OutreachHistoryTable'
import type { HistoryRow } from './historyStatus.util'

const desktopTable = () => screen.getAllByRole('table')[0] as HTMLElement

describe('OutreachHistoryTable — unified history', () => {
  it('renders both legacy status vocabularies', () => {
    const rows: HistoryRow[] = [
      // P2P row (phoneListId set): active Peerly job displays as Sent.
      {
        id: 1,
        date: '2026-07-02',
        outreachType: 'p2p',
        name: 'July rent-cap push',
        status: 'paid',
        phoneListId: 42,
        p2pJob: { status: 'active' },
        textCount: 1204,
      },
      // P2P pending is a real unfinished draft.
      {
        id: 2,
        date: '2026-07-01',
        outreachType: 'text',
        name: 'Draft blast',
        status: 'pending',
        phoneListId: 43,
        p2pJob: { status: 'building' },
      },
      // Non-P2P pending means "request submitted" → In review.
      {
        id: 3,
        date: '2026-06-24',
        outreachType: 'robocall',
        name: 'Budget hearing reminder',
        status: 'pending',
      },
    ]

    render(<OutreachHistoryTable rows={rows} onRowClick={vi.fn()} />)

    const table = within(desktopTable())
    expect(table.getByText('Done')).toBeInTheDocument()
    expect(table.getByText('Draft')).toBeInTheDocument()
    expect(table.getByText('In review')).toBeInTheDocument()
    expect(table.getAllByText('SMS')).toHaveLength(2)
    expect(table.getByText('Robocall')).toBeInTheDocument()
    // The people cell splits the number from the unit.
    expect(table.getByText('1,204')).toBeInTheDocument()
    expect(table.getByText('people')).toBeInTheDocument()
  })

  it('filters by channel and status and can clear', async () => {
    const rows: HistoryRow[] = [
      {
        id: 1,
        date: '2026-07-02',
        outreachType: 'socialMedia',
        name: 'Intro post',
        status: 'completed',
      },
      {
        id: 2,
        date: '2026-07-01',
        outreachType: 'robocall',
        name: 'Budget hearing reminder',
        status: 'pending',
      },
    ]

    render(<OutreachHistoryTable rows={rows} onRowClick={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await userEvent.click(screen.getByLabelText('Robocall'))

    let table = within(desktopTable())
    expect(table.getByText('Intro post')).toBeInTheDocument()
    expect(table.queryByText('Budget hearing reminder')).not.toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Social media'))
    expect(
      within(desktopTable()).getAllByText('No campaigns match your filters.'),
    ).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    table = within(desktopTable())
    expect(table.getByText('Intro post')).toBeInTheDocument()
    expect(table.getByText('Budget hearing reminder')).toBeInTheDocument()
  })

  it('filters by status label', async () => {
    const rows: HistoryRow[] = [
      {
        id: 1,
        date: '2026-07-02',
        outreachType: 'robocall',
        name: 'Done call',
        status: 'completed',
      },
      {
        id: 2,
        date: '2026-07-01',
        outreachType: 'robocall',
        name: 'Reviewing call',
        status: 'pending',
      },
    ]

    render(<OutreachHistoryTable rows={rows} onRowClick={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await userEvent.click(screen.getByLabelText('Done'))

    const table = within(desktopTable())
    expect(table.getByText('Reviewing call')).toBeInTheDocument()
    expect(table.queryByText('Done call')).not.toBeInTheDocument()
  })

  // The knock transaction writes a nativeDoorKnocking envelope, but the type
  // was missing from CHANNEL_META, so getChannelLabel fell through to its
  // capitalize fallback and every walk rendered as a grey "NativeDoorKnocking".
  it('labels a nativeDoorKnocking row as Door knocking', () => {
    const rows: HistoryRow[] = [
      {
        id: 1,
        date: '2026-08-20',
        outreachType: 'nativeDoorKnocking',
        name: 'Elm & Cedar',
        status: 'in_progress',
      },
    ]

    render(<OutreachHistoryTable rows={rows} onRowClick={vi.fn()} />)

    const table = within(desktopTable())
    expect(table.getByText('Door knocking')).toBeInTheDocument()
    expect(table.queryByText('NativeDoorKnocking')).not.toBeInTheDocument()
  })

  // in_progress means a canvasser is walking, not the non-p2p map's
  // "Scheduled" — the same call nativePhoneBanking already makes.
  it('renders in_progress as In progress for a nativeDoorKnocking row', () => {
    const rows: HistoryRow[] = [
      {
        id: 1,
        date: '2026-08-20',
        outreachType: 'nativeDoorKnocking',
        name: 'Elm & Cedar',
        status: 'in_progress',
      },
    ]

    render(<OutreachHistoryTable rows={rows} onRowClick={vi.fn()} />)

    expect(within(desktopTable()).getByText('In progress')).toBeInTheDocument()
    expect(within(desktopTable()).queryByText('Scheduled')).toBeNull()
  })

  // Rows the filters cannot name always show, so before nativeDoorKnocking
  // joined the door channel and "In progress" joined the status list, neither
  // pill could hide a walk. Both directions are asserted because "always
  // visible" passes a naive presence check.
  it('lets the door and In progress filters hide a native walk', async () => {
    const rows: HistoryRow[] = [
      {
        id: 1,
        date: '2026-08-20',
        outreachType: 'nativeDoorKnocking',
        name: 'Elm & Cedar',
        status: 'in_progress',
      },
      {
        id: 2,
        date: '2026-08-19',
        outreachType: 'robocall',
        name: 'Budget hearing reminder',
        status: 'pending',
      },
    ]

    render(<OutreachHistoryTable rows={rows} onRowClick={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))

    await userEvent.click(screen.getByLabelText('Door knocking'))
    expect(within(desktopTable()).queryByText('Elm & Cedar')).toBeNull()
    expect(
      within(desktopTable()).getByText('Budget hearing reminder'),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Door knocking'))
    expect(within(desktopTable()).getByText('Elm & Cedar')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('In progress'))
    expect(within(desktopTable()).queryByText('Elm & Cedar')).toBeNull()
  })

  it('shows the platform count for a social row from the detail fetch', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: {
        id: 9,
        createdAt: new Date('2026-08-01T00:00:00Z'),
        updatedAt: new Date('2026-08-01T00:00:00Z'),
        campaignId: 1,
        outreachType: 'socialMedia',
        projectId: null,
        name: 'Introduce myself',
        status: 'completed',
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
        social: {
          purpose: 'introduce_myself',
          draftMessage: 'Hello neighbors',
          assets: [
            {
              platform: 'facebook',
              kind: 'post_copy',
              text: 'Post',
              caption: null,
            },
            { platform: 'x', kind: 'post_copy', text: 'Post', caption: null },
            {
              platform: 'tiktok',
              kind: 'video_script',
              text: 'Script',
              caption: 'Caption',
            },
          ],
        },
      },
    })

    const rows: HistoryRow[] = [
      {
        id: 9,
        createdAt: '2026-08-01T00:00:00Z',
        outreachType: 'socialMedia',
        name: 'Introduce myself',
        status: 'completed',
      },
    ]

    render(<OutreachHistoryTable rows={rows} onRowClick={vi.fn()} />)

    expect(
      await within(desktopTable()).findByText('3 platforms'),
    ).toBeInTheDocument()
    expect(within(desktopTable()).getByText('Social media')).toBeInTheDocument()
  })

  it('paginates at 10 rows and pages newest-first', async () => {
    const rows: HistoryRow[] = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      date: `2026-06-${String(i + 1).padStart(2, '0')}`,
      outreachType: 'robocall',
      name: `Campaign ${i + 1}`,
      status: 'completed',
    }))

    render(<OutreachHistoryTable rows={rows} onRowClick={vi.fn()} />)

    const table = within(desktopTable())
    // Newest first: campaign 12 on page one, campaign 1 pushed to page two.
    expect(table.getByText('Campaign 12')).toBeInTheDocument()
    expect(table.queryByText('Campaign 1')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('link', { name: '2' }))

    expect(within(desktopTable()).getByText('Campaign 1')).toBeInTheDocument()
    expect(
      within(desktopTable()).queryByText('Campaign 12'),
    ).not.toBeInTheDocument()
  })

  it('opens the row on click', async () => {
    const onRowClick = vi.fn()
    const rows: HistoryRow[] = [
      {
        id: 5,
        date: '2026-06-24',
        outreachType: 'robocall',
        name: 'Budget hearing reminder',
        status: 'completed',
      },
    ]

    render(<OutreachHistoryTable rows={rows} onRowClick={onRowClick} />)

    await userEvent.click(
      within(desktopTable()).getByText('Budget hearing reminder'),
    )

    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }))
  })

  it('shows people-called and supporters for a nativePhoneBanking row from the detail fetch', async () => {
    api.mock('GET /v1/outreach/:id', {
      status: 200,
      data: {
        id: 11,
        createdAt: new Date('2026-08-10T00:00:00Z'),
        updatedAt: new Date('2026-08-10T00:00:00Z'),
        campaignId: 1,
        outreachType: 'nativePhoneBanking',
        projectId: null,
        name: 'GOTV calls',
        status: 'in_progress',
        error: null,
        audienceRequest: null,
        script: null,
        message: null,
        date: null,
        imageUrl: null,
        voterFileFilterId: null,
        doorKnockingRouteId: null,
        phoneBankingListId: 5,
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
        phoneBanking: {
          listId: 5,
          entriesTotal: 10,
          entriesCalled: 4,
          peopleTotal: 16,
          peopleCalled: 6,
          byOutcome: {
            answered: 3,
            no_answer: 1,
            voicemail: 0,
            wrong_number: 0,
            refused: 0,
          },
          supporters: 2,
          unsure: 1,
          nonSupporters: 0,
        },
      },
    })

    const rows: HistoryRow[] = [
      {
        id: 11,
        createdAt: '2026-08-10T00:00:00Z',
        outreachType: 'nativePhoneBanking',
        name: 'GOTV calls',
        status: 'in_progress',
      },
    ]

    render(<OutreachHistoryTable rows={rows} onRowClick={vi.fn()} />)

    expect(
      await within(desktopTable()).findByText('6 people called'),
    ).toBeInTheDocument()
    expect(within(desktopTable()).getByText('2 supporters')).toBeInTheDocument()
    expect(
      within(desktopTable()).getByText('Phone banking'),
    ).toBeInTheDocument()
    // in_progress means callers are actively dialing — never the non-p2p
    // map's "Scheduled".
    expect(within(desktopTable()).getByText('In progress')).toBeInTheDocument()
    expect(
      within(desktopTable()).queryByText('Scheduled'),
    ).not.toBeInTheDocument()
  })

  it('leaves a legacy phoneBanking row rendering n/a and an em-dash', () => {
    const rows: HistoryRow[] = [
      {
        id: 12,
        date: '2026-07-15',
        outreachType: 'phoneBanking',
        name: 'Legacy phone bank',
        status: 'completed',
      },
    ]

    render(<OutreachHistoryTable rows={rows} onRowClick={vi.fn()} />)

    const table = within(desktopTable())
    expect(table.getByText('n/a')).toBeInTheDocument()
    expect(table.getByText('—')).toBeInTheDocument()
    expect(table.getByText('Phone banking')).toBeInTheDocument()
  })

  it('sorts a freshly created row (createdAt, no date — the phone-banking optimistic-prepend shape) above older dated rows', () => {
    const rows: HistoryRow[] = [
      {
        id: 20,
        date: '2020-01-01',
        outreachType: 'robocall',
        name: 'Old campaign',
        status: 'completed',
      },
      {
        id: 21,
        createdAt: new Date().toISOString(),
        outreachType: 'phoneBanking',
        name: 'Freshly created',
        status: 'in_progress',
      },
    ]

    render(<OutreachHistoryTable rows={rows} onRowClick={vi.fn()} />)

    const names = within(desktopTable())
      .getAllByText(/^(Old campaign|Freshly created)$/)
      .map((el) => el.textContent)
    expect(names).toEqual(['Freshly created', 'Old campaign'])
  })

  it('hides archived rows by default and shows only them once toggled', async () => {
    const rows: HistoryRow[] = [
      {
        id: 30,
        date: '2026-08-01',
        outreachType: 'robocall',
        name: 'Active campaign',
        status: 'completed',
      },
      {
        id: 31,
        date: '2026-07-01',
        outreachType: 'robocall',
        name: 'Archived campaign',
        status: 'completed',
        archivedAt: '2026-08-10T00:00:00Z',
      },
    ]

    render(<OutreachHistoryTable rows={rows} onRowClick={vi.fn()} />)

    let table = within(desktopTable())
    expect(table.getByText('Active campaign')).toBeInTheDocument()
    expect(table.queryByText('Archived campaign')).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: 'Archive' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(toggle)

    expect(screen.getByText('Archived outreach')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Completed and cancelled campaigns from earlier cycles.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Back to active' }),
    ).toHaveAttribute('aria-pressed', 'true')

    table = within(desktopTable())
    expect(table.getByText('Archived campaign')).toBeInTheDocument()
    expect(table.queryByText('Active campaign')).not.toBeInTheDocument()
  })

  it('an active filter hiding every archived row reads as a filter miss, not an empty archive', async () => {
    const rows: HistoryRow[] = [
      {
        id: 32,
        date: '2026-07-01',
        outreachType: 'robocall',
        name: 'Archived robocall',
        status: 'completed',
        archivedAt: '2026-08-10T00:00:00Z',
      },
    ]

    render(<OutreachHistoryTable rows={rows} onRowClick={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await userEvent.click(screen.getByLabelText('Robocall'))
    await userEvent.click(screen.getByRole('button', { name: 'Archive' }))

    expect(
      within(desktopTable()).getByText('No campaigns match your filters.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('No archived campaigns.')).not.toBeInTheDocument()
  })

  it('an all-archived history points at the Archive toggle, not the filters', () => {
    const rows: HistoryRow[] = [
      {
        id: 33,
        date: '2026-07-01',
        outreachType: 'robocall',
        name: 'Archived robocall',
        status: 'completed',
        archivedAt: '2026-08-10T00:00:00Z',
      },
    ]

    render(<OutreachHistoryTable rows={rows} onRowClick={vi.fn()} />)

    expect(
      within(desktopTable()).getByText(
        'All your campaigns are archived. Click “Archive” to view them.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('No campaigns match your filters.'),
    ).not.toBeInTheDocument()
  })

  // Verification-pending substitution (ENG design): a scheduled SMS row
  // will be held by the carriers, so it must not read "Scheduled".
  const willNotSendRows: HistoryRow[] = [
    {
      id: 1,
      date: '2026-09-08',
      outreachType: 'p2p',
      name: 'Held SMS blast',
      status: 'paid',
      phoneListId: 42,
      p2pJob: { status: 'building' },
    },
    {
      id: 2,
      date: '2026-09-07',
      outreachType: 'robocall',
      name: 'Scheduled robocall',
      status: 'paid',
    },
  ]

  it('shows Will not send for a scheduled SMS row while verification pends', () => {
    render(
      <OutreachHistoryTable
        rows={willNotSendRows}
        onRowClick={vi.fn()}
        notCleared
      />,
    )

    const table = within(desktopTable())
    // Only the SMS row substitutes — the robocall keeps Scheduled.
    expect(table.getByText('Will not send')).toBeInTheDocument()
    expect(table.getByText('Scheduled')).toBeInTheDocument()
  })

  it('keeps Scheduled on SMS rows once verification has cleared', () => {
    render(<OutreachHistoryTable rows={willNotSendRows} onRowClick={vi.fn()} />)

    const table = within(desktopTable())
    expect(table.queryByText('Will not send')).not.toBeInTheDocument()
    expect(table.getAllByText('Scheduled')).toHaveLength(2)
  })

  it('filters on the displayed label: Scheduled misses a Will not send row and vice versa', async () => {
    render(
      <OutreachHistoryTable
        rows={willNotSendRows}
        onRowClick={vi.fn()}
        notCleared
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await userEvent.click(screen.getByLabelText('Scheduled'))

    let table = within(desktopTable())
    expect(table.getByText('Held SMS blast')).toBeInTheDocument()
    expect(table.queryByText('Scheduled robocall')).not.toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Scheduled'))
    await userEvent.click(screen.getByLabelText('Will not send'))

    table = within(desktopTable())
    expect(table.getByText('Scheduled robocall')).toBeInTheDocument()
    expect(table.queryByText('Held SMS blast')).not.toBeInTheDocument()
  })
})

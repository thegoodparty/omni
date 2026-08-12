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
    expect(table.getByText('Sent')).toBeInTheDocument()
    expect(table.getByText('Draft')).toBeInTheDocument()
    expect(table.getByText('In review')).toBeInTheDocument()
    expect(table.getAllByText('SMS')).toHaveLength(2)
    expect(table.getByText('Robocall')).toBeInTheDocument()
    expect(table.getByText('1,204 people')).toBeInTheDocument()
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
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import type { SmsApprovalQueueItem } from '@goodparty_org/contracts'
import { SmsQueue } from './SmsQueue'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  ResizeObserverMock as unknown as typeof ResizeObserver

const { mockPush, mockReplace, searchParamsRef } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockReplace: vi.fn(),
  searchParamsRef: { current: new URLSearchParams() },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
  useSearchParams: () => searchParamsRef.current,
}))
// Plain anchor so clicking the campaign link in jsdom exercises our
// bubbling behavior instead of Next's router internals.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

beforeEach(() => {
  mockPush.mockReset()
  mockReplace.mockReset()
  searchParamsRef.current = new URLSearchParams()
})

const item = (
  overrides: Partial<SmsApprovalQueueItem>
): SmsApprovalQueueItem => ({
  id: 41,
  campaignId: 9,
  campaignSlug: 'jane-doe',
  candidateName: 'Jane Doe',
  name: 'Likely voters — SMS',
  createdAt: new Date('2026-08-30T00:00:00Z'),
  sendAt: new Date('2026-09-10T15:00:00Z'),
  scheduledLocalDate: '2026-09-10',
  scheduledLocalTime: '18:00',
  script: 'Hello {first_name}…',
  imageUrl: null,
  textCount: 1200,
  billableTextCount: 1200,
  paid: true,
  approvalStatus: 'awaiting_review',
  approvedAt: null,
  approvedBy: null,
  deniedAt: null,
  deniedBy: null,
  deniedReason: null,
  canvassRequestedAt: null,
  adminEditedAt: null,
  adminEditedBy: null,
  canceledAt: null,
  canceledBy: null,
  canceledByAdmin: false,
  assignedPa: null,
  standards: { passed: true, failures: [] },
  job: {
    status: 'active',
    deliverabilityCheckError: null,
    hasCanvassersScheduled: false,
    peerlyApproved: null,
    leadsRemaining: 1200,
  },
  ...overrides,
})

describe('SmsQueue', () => {
  it('buckets rows into tabs and renders the review row', async () => {
    render(
      <Theme>
        <SmsQueue
          viewerName={null}
          items={[
            item({ id: 41 }),
            item({
              id: 42,
              name: 'Booked send',
              approvalStatus: 'canvass_requested',
              canvassRequestedAt: new Date(),
            }),
            item({
              id: 43,
              name: 'Denied send',
              approvalStatus: 'denied',
              deniedAt: new Date(),
              deniedReason: 'bad link',
            }),
            item({
              id: 44,
              name: 'Canceled send',
              approvalStatus: 'canceled',
              canceledAt: new Date(),
              canceledBy: 'cas@goodparty.org',
              canceledByAdmin: true,
              job: null,
            }),
          ]}
        />
      </Theme>
    )

    expect(
      screen.getByRole('tab', { name: /Awaiting review \(1\)/ })
    ).toBeInTheDocument()
    expect(screen.getByText('Likely voters — SMS')).toBeInTheDocument()
    expect(screen.queryByText('Booked send')).not.toBeInTheDocument()
    // The queue shows the candidate's stored day + wall-clock time (what
    // Peerly shows), never the instant converted to Eastern.
    expect(
      screen.getByRole('button', { name: /Send time/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'About send times' })
    ).toBeInTheDocument()
    expect(screen.getByText('Sep 10, 2026, 6:00 PM')).toBeInTheDocument()
    expect(
      screen.queryByText('Sep 10, 2026, 11:00 AM EDT')
    ).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: /Booked \(1\)/ }))
    expect(screen.getByText('Booked send')).toBeInTheDocument()
    expect(screen.getByText('Send booked')).toBeInTheDocument()
    // Booked + active job reads Active, not the pre-approval Ready.
    expect(screen.getByText('Active')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: /Denied \(1\)/ }))
    expect(screen.getByText('Denied send')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: /Canceled \(1\)/ }))
    expect(screen.getByText('Canceled send')).toBeInTheDocument()
    // A canceled row's job is deleted by design — not a failed read.
    expect(screen.queryByText('Vendor read failed')).not.toBeInTheDocument()

    // The whole row is clickable, not just the campaign link.
    await userEvent.click(screen.getByText('Jane Doe'))
    expect(mockPush).toHaveBeenCalledWith('/dashboard/sms-outreach/44')
  })

  it('does not double-navigate or hijack modified clicks', async () => {
    render(
      <Theme>
        <SmsQueue viewerName={null} items={[item({ id: 41 })]} />
      </Theme>
    )

    // The campaign link owns its own navigation — the row handler must
    // not push a second history entry on top of it.
    await userEvent.click(
      screen.getByRole('link', { name: 'Likely voters — SMS' })
    )
    expect(mockPush).not.toHaveBeenCalled()

    // Cmd/ctrl-click stays with the browser (open in new tab).
    fireEvent.click(screen.getByText('Jane Doe'), { metaKey: true })
    expect(mockPush).not.toHaveBeenCalled()

    await userEvent.click(screen.getByText('Jane Doe'))
    expect(mockPush).toHaveBeenCalledTimes(1)
  })

  it('flags a booked job the vendor still has inactive', async () => {
    render(
      <Theme>
        <SmsQueue
          viewerName={null}
          items={[
            item({
              id: 46,
              name: 'Booked but paused',
              approvalStatus: 'canvass_requested',
              canvassRequestedAt: new Date(),
              job: {
                status: 'paused',
                deliverabilityCheckError: null,
                hasCanvassersScheduled: true,
                peerlyApproved: true,
                leadsRemaining: 1200,
              },
            }),
          ]}
        />
      </Theme>
    )

    await userEvent.click(screen.getByRole('tab', { name: /Booked \(1\)/ }))
    expect(screen.getByText('Needs activation')).toBeInTheDocument()
  })

  it('flags standards failures and vendor readiness problems', () => {
    render(
      <Theme>
        <SmsQueue
          viewerName={null}
          items={[
            item({
              id: 44,
              standards: {
                passed: false,
                failures: ['opt_out_line', 'first_name_token'],
              },
              job: {
                status: 'active',
                deliverabilityCheckError: 'list rejected',
                hasCanvassersScheduled: false,
                peerlyApproved: null,
                leadsRemaining: null,
              },
            }),
            item({ id: 45, name: 'No vendor read', job: null }),
          ]}
        />
      </Theme>
    )

    expect(screen.getByText('2 issues')).toBeInTheDocument()
    expect(screen.getByText('Deliverability error')).toBeInTheDocument()
    expect(screen.getByText('Vendor read failed')).toBeInTheDocument()
  })

  it('renders the empty state', () => {
    render(
      <Theme>
        <SmsQueue viewerName={null} items={[]} />
      </Theme>
    )
    expect(screen.getByText('Nothing here right now.')).toBeInTheDocument()
  })

  it('searches by candidate and sorts by candidate name', async () => {
    render(
      <Theme>
        <SmsQueue
          viewerName={null}
          items={[
            item({
              id: 51,
              candidateName: 'Zoe Adams',
              name: 'Zoe campaign',
              sendAt: new Date('2026-09-08T15:00:00Z'),
            }),
            item({
              id: 52,
              candidateName: 'Amy Brown',
              name: 'Amy campaign',
              campaignSlug: 'amy-brown-2026',
              sendAt: new Date('2026-09-12T15:00:00Z'),
            }),
          ]}
        />
      </Theme>
    )

    // Default sort is send date ascending: Zoe (9/08) before Amy (9/12).
    const beforeSort = screen.getAllByText(/campaign$/)
    expect(beforeSort[0]).toHaveTextContent('Zoe campaign')

    await userEvent.click(screen.getByRole('button', { name: /Candidate/ }))
    const afterSort = screen.getAllByText(/campaign$/)
    expect(afterSort[0]).toHaveTextContent('Amy campaign')

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Search campaigns' }),
      'zoe'
    )
    expect(screen.getByText('Zoe campaign')).toBeInTheDocument()
    expect(screen.queryByText('Amy campaign')).not.toBeInTheDocument()

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Search campaigns' }),
      'zzz'
    )
    expect(
      screen.getByText('No campaigns match your search.')
    ).toBeInTheDocument()

    // Slug and campaign-name fields match too, not just the candidate.
    await userEvent.clear(
      screen.getByRole('textbox', { name: 'Search campaigns' })
    )
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Search campaigns' }),
      'amy-brown-2026'
    )
    expect(screen.getByText('Amy campaign')).toBeInTheDocument()
    expect(screen.queryByText('Zoe campaign')).not.toBeInTheDocument()
  })

  describe('my approvals filter', () => {
    const teamItems = () => [
      item({ id: 61, name: 'Mine send', assignedPa: '  jane SMITH ' }),
      item({
        id: 62,
        name: 'Bob send',
        candidateName: 'Amy Brown',
        campaignSlug: 'amy-brown',
        assignedPa: 'Bob Ross',
      }),
      item({
        id: 63,
        name: 'Unassigned send',
        candidateName: 'Zoe Adams',
        campaignSlug: 'zoe-adams',
        assignedPa: null,
      }),
    ]

    it('hides the toggle when the viewer has no name', () => {
      render(
        <Theme>
          <SmsQueue viewerName={null} items={teamItems()} />
        </Theme>
      )
      expect(
        screen.queryByRole('button', { name: 'My approvals' })
      ).not.toBeInTheDocument()
    })

    it('shows every row until toggled, then writes the filter to the URL', async () => {
      render(
        <Theme>
          <SmsQueue viewerName="Jane Smith" items={teamItems()} />
        </Theme>
      )

      expect(screen.getByText('Mine send')).toBeInTheDocument()
      expect(screen.getByText('Bob send')).toBeInTheDocument()
      expect(screen.getByText('Unassigned send')).toBeInTheDocument()

      const toggle = screen.getByRole('button', { name: 'My approvals' })
      expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await userEvent.click(toggle)
      expect(mockReplace).toHaveBeenCalledWith(
        '/dashboard/sms-outreach?mine=1',
        { scroll: false }
      )
    })

    // The URL is the persistence mechanism: a fresh mount (post
    // router.refresh() or reload) with ?mine=1 restores the filter.
    it('filters to the viewer when the URL carries mine=1', () => {
      searchParamsRef.current = new URLSearchParams('mine=1')
      render(
        <Theme>
          <SmsQueue viewerName="Jane Smith" items={teamItems()} />
        </Theme>
      )

      // Assigned-PA match is case-insensitive and whitespace-trimmed.
      expect(screen.getByText('Mine send')).toBeInTheDocument()
      expect(screen.queryByText('Bob send')).not.toBeInTheDocument()
      expect(screen.queryByText('Unassigned send')).not.toBeInTheDocument()
      // Tab counts narrow with the filter.
      expect(
        screen.getByRole('tab', { name: /Awaiting review \(1\)/ })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'My approvals' })
      ).toHaveAttribute('aria-pressed', 'true')
    })

    it('clears the URL param when toggled off', async () => {
      searchParamsRef.current = new URLSearchParams('mine=1')
      render(
        <Theme>
          <SmsQueue viewerName="Jane Smith" items={teamItems()} />
        </Theme>
      )

      await userEvent.click(
        screen.getByRole('button', { name: 'My approvals' })
      )
      expect(mockReplace).toHaveBeenCalledWith('/dashboard/sms-outreach', {
        scroll: false,
      })
    })

    it('shows the no-match empty state when nothing is assigned to the viewer', () => {
      searchParamsRef.current = new URLSearchParams('mine=1')
      render(
        <Theme>
          <SmsQueue viewerName="Pat Newhire" items={teamItems()} />
        </Theme>
      )

      expect(
        screen.getByText('No approvals assigned to you here.')
      ).toBeInTheDocument()
    })
  })
})

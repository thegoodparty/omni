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

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
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
          ]}
        />
      </Theme>
    )

    expect(
      screen.getByRole('tab', { name: /Awaiting review \(1\)/ })
    ).toBeInTheDocument()
    expect(screen.getByText('Likely voters — SMS')).toBeInTheDocument()
    expect(screen.queryByText('Booked send')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: /Booked \(1\)/ }))
    expect(screen.getByText('Booked send')).toBeInTheDocument()
    expect(screen.getByText('Send booked')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: /Denied \(1\)/ }))
    expect(screen.getByText('Denied send')).toBeInTheDocument()

    // The whole row is clickable, not just the campaign link.
    await userEvent.click(screen.getByText('Jane Doe'))
    expect(mockPush).toHaveBeenCalledWith('/dashboard/sms-outreach/43')
  })

  it('does not double-navigate or hijack modified clicks', async () => {
    render(
      <Theme>
        <SmsQueue items={[item({ id: 41 })]} />
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

  it('flags standards failures and vendor readiness problems', () => {
    render(
      <Theme>
        <SmsQueue
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
        <SmsQueue items={[]} />
      </Theme>
    )
    expect(screen.getByText('Nothing here right now.')).toBeInTheDocument()
  })

  it('searches by candidate and sorts by candidate name', async () => {
    render(
      <Theme>
        <SmsQueue
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
})

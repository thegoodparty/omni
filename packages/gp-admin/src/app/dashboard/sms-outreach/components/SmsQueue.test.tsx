import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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
      screen.getByRole('textbox', { name: 'Search by candidate' }),
      'zoe'
    )
    expect(screen.getByText('Zoe campaign')).toBeInTheDocument()
    expect(screen.queryByText('Amy campaign')).not.toBeInTheDocument()

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Search by candidate' }),
      'zzz'
    )
    expect(
      screen.getByText('No campaigns match that candidate.')
    ).toBeInTheDocument()
  })
})

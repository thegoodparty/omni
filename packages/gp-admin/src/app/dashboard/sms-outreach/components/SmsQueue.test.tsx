import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import type { SmsApprovalQueueItem } from '@goodparty_org/contracts'
import { SmsQueue } from './SmsQueue'

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
})

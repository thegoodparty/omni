import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Theme } from '@radix-ui/themes'
import { PausedSendsTable } from './PausedSendsTable'

vi.mock('./SendActions', () => ({ SendActions: () => null }))

describe('PausedSendsTable', () => {
  it('shows each send’s delivery counts', () => {
    render(
      <Theme>
        <PausedSendsTable
          canDecide={false}
          items={[
            {
              outreachId: 7,
              organizationSlug: 'campaign-1',
              senderName: 'Jane Doe',
              subject: 'Town hall',
              pauseReason: 'bounce_rate',
              pausedAt: '2026-11-04T12:00:00.000Z',
              resumedAt: null,
              sentCount: 200,
              recipientCap: 1000,
              metrics: null,
              deliveryCounts: {
                sent: 200,
                delivered: 180,
                bounced: 15,
                complained: 2,
                opened: 90,
                clicked: 11,
              },
            },
          ]}
        />
      </Theme>
    )

    const cell = screen.getByTestId('delivery-counts')
    expect(cell.textContent).toBe(
      'Sent: 200Delivered: 180Bounced: 15Marked as spam: 2' +
        'Opened (approximate): 90Clicked: 11'
    )
  })
})

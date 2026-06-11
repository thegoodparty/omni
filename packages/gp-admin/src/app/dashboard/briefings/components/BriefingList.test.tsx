import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Theme } from '@radix-ui/themes'
import { BriefingList } from './BriefingList'
import type { BriefingAdminRow } from '../types'

vi.mock('./ReviewBriefingButton', () => ({
  ReviewBriefingButton: () => <button>Review</button>,
}))

const row = (overrides: Partial<BriefingAdminRow>): BriefingAdminRow => ({
  briefingId: 'b1',
  meetingDate: '2026-06-10',
  meetingName: 'City Council',
  user: { id: 1, firstName: 'Ada', lastName: 'L', email: 'ada@x.org' },
  electedOffice: { id: 'eo1', organizationSlug: 'org', positionName: null },
  updatedAt: '2026-06-10T00:00:00.000Z',
  review: null,
  ...overrides,
})

describe('BriefingList review column', () => {
  it('renders pending, passed, and failed states', () => {
    render(
      <Theme>
        <BriefingList
          briefings={[
            row({ briefingId: 'b1', review: null }),
            row({
              briefingId: 'b2',
              review: {
                verdict: 'passed',
                failReason: null,
                reviewerEmail: 'rev@goodparty.org',
                reviewedAt: '2026-06-10T00:00:00.000Z',
              },
            }),
            row({
              briefingId: 'b3',
              review: {
                verdict: 'failed',
                failReason: 'Bad summary',
                reviewerEmail: 'rev@goodparty.org',
                reviewedAt: '2026-06-10T00:00:00.000Z',
              },
            }),
          ]}
        />
      </Theme>
    )

    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Passed')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toHaveAttribute('title', 'Bad summary')
  })
})

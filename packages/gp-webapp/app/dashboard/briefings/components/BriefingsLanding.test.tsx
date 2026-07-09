import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import BriefingsLanding from './BriefingsLanding'
import type { BriefingSummary } from '@shared/briefings/types'

const daysFromNow = (days: number): string =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

const summary = (overrides: Partial<BriefingSummary>): BriefingSummary => ({
  id: 'id',
  slug: 'slug',
  meetingDate: 'Jan 1',
  meetingName: 'City Council',
  scheduledAt: daysFromNow(-10),
  location: 'City Hall',
  status: 'briefing_ready',
  ...overrides,
})

describe('BriefingsLanding', () => {
  it('shows the empty state when there are no meetings at all', () => {
    render(<BriefingsLanding summaries={[]} />)
    expect(
      screen.getByText("We're tracking down your meetings"),
    ).toBeInTheDocument()
  })

  it('renders Past instead of the empty state when only old meetings exist', () => {
    const past = summary({
      id: 'past-1',
      meetingName: 'Old Planning Meeting',
      scheduledAt: daysFromNow(-10),
    })

    render(<BriefingsLanding summaries={[past]} />)

    expect(
      screen.queryByText("We're tracking down your meetings"),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Past')).toBeInTheDocument()
    expect(screen.getByText('Old Planning Meeting')).toBeInTheDocument()
  })

  it('renders both Upcoming and Past when a featured meeting exists', () => {
    const featured = summary({
      id: 'featured-1',
      meetingName: 'Next Council Meeting',
      scheduledAt: daysFromNow(2),
    })
    const past = summary({
      id: 'past-1',
      meetingName: 'Old Planning Meeting',
      scheduledAt: daysFromNow(-10),
    })

    render(<BriefingsLanding summaries={[featured, past]} />)

    expect(screen.getByText('Past')).toBeInTheDocument()
    expect(screen.getByText('Old Planning Meeting')).toBeInTheDocument()
  })
})

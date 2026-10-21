import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import UpcomingCountdownCard from './UpcomingCountdownCard'
import type { BriefingSummary } from '@shared/briefings/types'

const summary = (overrides: Partial<BriefingSummary>): BriefingSummary => ({
  id: 'id',
  slug: '2030-01-01',
  meetingDate: 'Jan 1',
  meetingName: 'City Council',
  scheduledAt: new Date(Date.now() + 86400000).toISOString(),
  location: 'City Hall',
  status: 'briefing_ready',
  ...overrides,
})

describe('UpcomingCountdownCard', () => {
  it('offers Replace agenda alongside View briefing when ready', () => {
    render(<UpcomingCountdownCard summary={summary({})} />)
    expect(screen.getByText('View briefing')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /replace agenda/i }),
    ).toBeInTheDocument()
  })

  it('hides Replace agenda while a run is processing', () => {
    render(
      <UpcomingCountdownCard
        summary={summary({ userAgendaStatus: 'processing' })}
      />,
    )
    expect(
      screen.queryByRole('button', { name: /replace agenda/i }),
    ).not.toBeInTheDocument()
  })
})

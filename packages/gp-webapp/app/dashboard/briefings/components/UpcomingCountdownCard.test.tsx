import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import UpcomingCountdownCard from './UpcomingCountdownCard'
import type { BriefingSummary } from '@shared/briefings/types'

const summary = (
  overrides: Partial<BriefingSummary> = {},
): BriefingSummary => ({
  id: 'id',
  slug: '2026-10-05',
  meetingDate: 'October 5, 2026',
  meetingName: 'City Council',
  scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  location: 'City Hall',
  status: 'briefing_ready',
  ...overrides,
})

describe('UpcomingCountdownCard', () => {
  it('offers View briefing and Replace agenda on a ready meeting', () => {
    render(<UpcomingCountdownCard summary={summary()} />)
    expect(screen.getByRole('link', { name: /View briefing/ })).toHaveAttribute(
      'href',
      '/dashboard/briefings/2026-10-05',
    )
    expect(
      screen.getByRole('button', { name: 'Replace agenda for City Council' }),
    ).toBeEnabled()
  })

  it('disables Replace agenda while a replacement is processing', () => {
    render(
      <UpcomingCountdownCard
        summary={summary({ userAgendaStatus: 'processing' })}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Replace agenda for City Council' }),
    ).toBeDisabled()
    expect(screen.getByText('Processing your agenda…')).toBeInTheDocument()
  })

  it('shows why a replacement was turned down on a ready meeting', () => {
    render(
      <UpcomingCountdownCard
        summary={summary({
          userAgendaStatus: 'rejected',
          userAgendaReason: 'packet_date_mismatch:2026-09-21:2026-10-05',
        })}
      />,
    )
    expect(
      screen.getByText('Agenda is for a different meeting (dated 2026-09-21)'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Replace agenda for City Council' }),
    ).toBeEnabled()
  })

  it('offers Upload agenda instead when there is no briefing yet', () => {
    render(
      <UpcomingCountdownCard
        summary={summary({ status: 'awaiting_agenda' })}
      />,
    )
    expect(
      screen.getByRole('button', { name: /Upload agenda/ }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Replace agenda')).not.toBeInTheDocument()
  })
})

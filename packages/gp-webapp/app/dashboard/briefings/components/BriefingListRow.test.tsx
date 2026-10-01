import { describe, it, expect } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import BriefingListRow from './BriefingListRow'
import type { BriefingSummary } from '@shared/briefings/types'

const summary = (
  overrides: Partial<BriefingSummary> = {},
): BriefingSummary => ({
  id: 'id',
  slug: '2026-10-05',
  meetingDate: 'October 5, 2026',
  meetingName: 'City Council',
  scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  location: 'City Hall',
  status: 'briefing_ready',
  ...overrides,
})

describe('BriefingListRow', () => {
  it('offers Replace agenda on a ready row when the list allows it', () => {
    render(<BriefingListRow summary={summary()} allowReplace />)
    expect(
      screen.getByRole('button', { name: 'Replace agenda for City Council' }),
    ).toBeEnabled()
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/dashboard/briefings/2026-10-05',
    )
  })

  it('does not offer it when the list does not allow it (Past)', () => {
    render(<BriefingListRow summary={summary()} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('disables it while a replacement run is processing', () => {
    render(
      <BriefingListRow
        summary={summary({ userAgendaStatus: 'processing' })}
        allowReplace
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Replace agenda for City Council' }),
    ).toBeDisabled()
  })

  it('opens the agenda modal for that meeting date', () => {
    render(<BriefingListRow summary={summary()} allowReplace />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Replace agenda for City Council' }),
    )
    expect(
      screen.getByText(/Drop in a link to the meeting packet/),
    ).toBeInTheDocument()
  })
})

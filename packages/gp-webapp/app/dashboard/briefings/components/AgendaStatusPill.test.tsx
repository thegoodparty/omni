import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import AgendaStatusPill, { labelForRejection } from './AgendaStatusPill'

describe('AgendaStatusPill', () => {
  it('names the meeting mismatch with the date the packet stated', () => {
    render(
      <AgendaStatusPill
        status="rejected"
        reason="packet_date_mismatch:2026-09-21:2026-10-05"
      />,
    )
    expect(
      screen.getByText('Agenda is for a different meeting (dated 2026-09-21)'),
    ).toBeInTheDocument()
  })

  it('says the agenda was not available when the run admitted it', () => {
    render(
      <AgendaStatusPill
        status="rejected"
        reason="agenda_unavailable:not_published"
      />,
    )
    expect(screen.getByText('Agenda not available yet')).toBeInTheDocument()
  })

  it('falls back to a generic label for an unknown reason', () => {
    expect(labelForRejection('something_else')).toBe("Couldn't use that agenda")
    expect(labelForRejection(null)).toBe("Couldn't use that agenda")
    expect(labelForRejection('packet_date_mismatch:unknown:2026-10-05')).toBe(
      'Agenda is for a different meeting',
    )
  })

  it('still renders the existing statuses', () => {
    render(<AgendaStatusPill status="processing" />)
    expect(screen.getByText('Processing your agenda…')).toBeInTheDocument()
  })
})

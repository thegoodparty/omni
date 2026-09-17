import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { RobocallScheduleStep } from './RobocallScheduleStep'

const NOW = new Date('2026-01-01T12:00:00.000Z')
const FAR_FUTURE_DAY = new Date('2026-02-01T00:00:00.000Z')
const MAX_SCHEDULED_DAY = new Date('2026-03-27T12:00:00.000Z')

const baseProps = {
  campaignName: 'Test campaign',
  onCampaignNameChange: vi.fn(),
  scheduledDay: FAR_FUTURE_DAY,
  onScheduledDayChange: vi.fn(),
  onTimeChange: vi.fn(),
  timeZone: 'America/New_York',
  earliest: NOW,
  maxScheduledDay: MAX_SCHEDULED_DAY,
  violates: false,
  isTooFarOut: false,
}

describe('RobocallScheduleStep — time slots', () => {
  it('caps the send-time options at 7:00 PM, with no 8 or 9 PM slot', async () => {
    render(<RobocallScheduleStep {...baseProps} time="10:00" />)

    await userEvent.click(screen.getByRole('combobox', { name: /Send time/ }))

    expect(
      await screen.findByRole('option', { name: '7:00 PM' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('option', { name: '8:00 PM' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('option', { name: '9:00 PM' }),
    ).not.toBeInTheDocument()
  })

  it('shows the 7 PM cutoff alert only when 7 PM is the selected time', () => {
    const { rerender } = render(
      <RobocallScheduleStep {...baseProps} time="10:00" />,
    )
    expect(
      screen.queryByText(/may run past the day's calling cutoff/),
    ).not.toBeInTheDocument()

    rerender(<RobocallScheduleStep {...baseProps} time="19:00" />)
    expect(
      screen.getByText(/may run past the day's calling cutoff/),
    ).toBeInTheDocument()
    // Informational, not blocking: no destructive violation copy alongside it.
    expect(
      screen.queryByText(/Pick a send date and time in the future/),
    ).not.toBeInTheDocument()
  })
})

describe('RobocallScheduleStep — schedule violations', () => {
  it('shows the past-time message when violates is set without isTooFarOut', () => {
    render(
      <RobocallScheduleStep
        {...baseProps}
        time="10:00"
        violates
        isTooFarOut={false}
      />,
    )
    expect(
      screen.getByText('Pick a send date and time in the future.'),
    ).toBeInTheDocument()
  })

  it('shows the 85-day cap message when isTooFarOut is set', () => {
    render(
      <RobocallScheduleStep {...baseProps} time="10:00" violates isTooFarOut />,
    )
    expect(
      screen.getByText('Pick a send date within the next 85 days.'),
    ).toBeInTheDocument()
  })
})

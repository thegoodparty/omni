import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { addBusinessDays, isWeekend } from 'date-fns'
import { render } from 'helpers/test-utils/render'
import {
  getDisabledState,
  POLLS_SCHEDULING_COPY,
} from 'app/dashboard/polls/components/PollScheduledDateSelector'
import {
  SERVE_SMS_SCHEDULE_COPY,
  serveSmsEstimatedCompletion,
  serveSmsScheduledAt,
  ServeSmsScheduleStep,
} from './ServeSmsScheduleStep'

// Tuesday. Chosen so the first bookable day (+3) stays inside the month.
const FROZEN_NOW = new Date('2026-09-01T12:00:00Z')

describe('serveSmsScheduledAt', () => {
  it('stamps the fixed 11am send hour onto the picked day', () => {
    const at11 = serveSmsScheduledAt(new Date(2026, 8, 4, 0, 0, 0, 0))
    expect(at11.getHours()).toBe(11)
    expect(at11.getMinutes()).toBe(0)
    expect(at11.getSeconds()).toBe(0)
    expect(at11.getMilliseconds()).toBe(0)
    expect(at11.getDate()).toBe(4)
  })
})

describe('serveSmsEstimatedCompletion', () => {
  it('is three business days after the send date, matching polls', () => {
    const scheduled = new Date(2026, 8, 4, 11, 0, 0, 0)
    expect(serveSmsEstimatedCompletion(scheduled)).toEqual(
      addBusinessDays(scheduled, 3),
    )
  })
})

// The point of lifting getDisabledState rather than re-deriving it: the two
// Serve products cannot disagree about the window. This pins the behavior the
// step relies on, so a change to the polls predicate shows up here.
describe('the borrowed polls window', () => {
  const now = new Date(2026, 8, 1)
  const day = (d: number) => new Date(2026, 8, d)

  it('closes the next two business days, the weekends, and past 30 days', () => {
    expect(getDisabledState(day(2), now).disabled).toBe(true)
    expect(getDisabledState(day(3), now).disabled).toBe(true)
    expect(getDisabledState(day(4), now).disabled).toBe(false)
    expect(isWeekend(day(5))).toBe(true)
    expect(getDisabledState(day(5), now).disabled).toBe(true)
    expect(getDisabledState(day(6), now).disabled).toBe(true)
    // Oct 2 is 31 days out.
    expect(getDisabledState(new Date(2026, 9, 2), now).disabled).toBe(true)
  })
})

describe('SERVE_SMS_SCHEDULE_COPY', () => {
  // The noun is SMS's; everything after it is the promise polls already
  // makes. Retyping the window would let the two drift.
  it('keeps POLLS_SCHEDULING_COPY’s promise verbatim after the noun', () => {
    const tail = (copy: string) => copy.slice(copy.indexOf('sent at'))
    expect(tail(SERVE_SMS_SCHEDULE_COPY.body)).toBe(tail(POLLS_SCHEDULING_COPY))
    expect(SERVE_SMS_SCHEDULE_COPY.body).not.toContain('polls')
  })
})

describe('ServeSmsScheduleStep', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(FROZEN_NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('states the fixed send time instead of offering a time picker', () => {
    render(
      <ServeSmsScheduleStep
        name="Northside residents — SMS"
        onNameChange={vi.fn()}
        date={undefined}
        onDateChange={vi.fn()}
      />,
    )

    expect(screen.getByText(SERVE_SMS_SCHEDULE_COPY.body)).toBeInTheDocument()
    expect(screen.getByText(/Sends at 11:00 AM/)).toBeInTheDocument()
    // Win's hourly slot picker has no counterpart here — the hour is a
    // constant, not a choice.
    expect(screen.queryByText('Send time')).toBeNull()
    expect(screen.queryByText('9:00 AM')).toBeNull()
  })

  it('shows the estimated completion once a date is picked', () => {
    render(
      <ServeSmsScheduleStep
        name="Northside residents — SMS"
        onNameChange={vi.fn()}
        date={new Date(2026, 8, 4, 11, 0, 0, 0)}
        onDateChange={vi.fn()}
      />,
    )

    expect(screen.getByText(/Estimated completion:/)).toBeInTheDocument()
    // Sep 4 + 3 business days = Wed Sep 9.
    expect(screen.getByText(/Wed, Sep 9, 2026/)).toBeInTheDocument()
  })
})

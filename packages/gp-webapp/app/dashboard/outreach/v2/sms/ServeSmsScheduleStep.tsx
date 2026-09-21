'use client'

import { useMemo, useState } from 'react'
import {
  addBusinessDays,
  addDays,
  setHours,
  setMilliseconds,
  setMinutes,
  setSeconds,
  startOfDay,
} from 'date-fns'
import { Input, Label } from '@styleguide'
import DateInputCalendar from '@shared/inputs/DateInputCalendar'
import { getDisabledState } from 'app/dashboard/polls/components/PollScheduledDateSelector'
import { Intro } from '../social/Intro'

// Serve's schedule step. Strictly simpler than the Win one next door, and
// the difference is not a design preference: Win's hourly slots are a Peerly
// send window the vendor enforces, while a Serve send is a CSV a human works
// through. Promising an hour we cannot keep would be a lie, so the flow makes
// the promise polls already ships instead — fixed 11am local, date only, at
// least 2 business days out, no more than 30, weekends closed. The predicate
// is lifted from PollScheduledDateSelector rather than re-derived, so the two
// Serve products can only disagree about the window in one place.
// See docs/features/serve-sms.md, "Send timing".

// Not a choice, so it never reaches the payload: ServeSmsCreateRequestSchema
// carries `scheduledLocalDate` and no `scheduledLocalTime`.
export const SERVE_SMS_SEND_HOUR = 11

// Matches polls.service.ts's estimated completion.
export const SERVE_SMS_COMPLETION_BUSINESS_DAYS = 3

// Stamps the fixed send hour onto a day the calendar hands back, the same
// way PollScheduledDateSelector does before it calls onChange.
export const serveSmsScheduledAt = (day: Date): Date =>
  setMilliseconds(
    setSeconds(setMinutes(setHours(day, SERVE_SMS_SEND_HOUR), 0), 0),
    0,
  )

export const serveSmsEstimatedCompletion = (scheduledDate: Date): Date =>
  addBusinessDays(scheduledDate, SERVE_SMS_COMPLETION_BUSINESS_DAYS)

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

// Every string this component renders is Serve copy — it is mounted only by
// the Serve surface — but it lives in a shared directory, where the
// vocabulary gate reads an unconditional string as Win copy. A SERVE_*
// object is what makes it visible to the check; see
// docs/product-vocabulary.md, "What it deliberately does not catch".
export const SERVE_SMS_SCHEDULE_COPY = {
  title: 'When do you want to send it?',
  // POLLS_SCHEDULING_COPY with the noun swapped for SMS. The test file pins
  // the two to the same tail, so the window can only be changed in one place.
  body: 'All messages are sent at 11am local time. You can schedule at least 2 business days in advance, and no more than 30 days out.',
  nameLabel: 'Campaign name',
  namePlaceholder: 'e.g. Street repaving update',
  nameHint: 'Internal name for this outreach campaign in your history.',
  dateLabel: 'Send date',
  sendTimeLine: (timeZone: string) => `Sends at 11:00 AM (${timeZone}).`,
  completionLine: (date: string) => `Estimated completion: ${date}.`,
  engagementHint:
    'Messages sent on Tuesdays or Thursdays receive the highest engagement.',
}

interface ServeSmsScheduleStepProps {
  name: string
  onNameChange: (value: string) => void
  // Already stamped to the fixed send hour by this step's own onChange, so
  // the flow reads it as the scheduled moment without resolving a slot.
  date: Date | undefined
  onDateChange: (date: Date | undefined) => void
}

export const ServeSmsScheduleStep = ({
  name,
  onNameChange,
  date,
  onDateChange,
}: ServeSmsScheduleStepProps) => {
  // Frozen for the life of the step, matching PollScheduledDateSelector: a
  // re-render must not shift the floor under a date already picked.
  const [now] = useState(() => startOfDay(new Date()))
  const timeZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return 'Local time'
    }
  }, [])
  const maxDate = useMemo(() => addDays(now, 30), [now])
  const estimatedCompletion = date ? serveSmsEstimatedCompletion(date) : null

  return (
    <div className="space-y-6">
      <Intro
        channel="text"
        title={SERVE_SMS_SCHEDULE_COPY.title}
        body={SERVE_SMS_SCHEDULE_COPY.body}
      />

      <div className="space-y-2">
        <Label htmlFor="serve-sms-name">
          {SERVE_SMS_SCHEDULE_COPY.nameLabel}
        </Label>
        <Input
          id="serve-sms-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={SERVE_SMS_SCHEDULE_COPY.namePlaceholder}
          maxLength={60}
        />
        <p className="text-sm text-muted-foreground">
          {SERVE_SMS_SCHEDULE_COPY.nameHint}
        </p>
      </div>

      <div className="space-y-2">
        <Label>{SERVE_SMS_SCHEDULE_COPY.dateLabel}</Label>
        <DateInputCalendar
          value={date}
          onChange={(picked) =>
            onDateChange(picked ? serveSmsScheduledAt(picked) : undefined)
          }
          disabled={(day) => getDisabledState(day, now).disabled}
          startMonth={now}
          endMonth={maxDate}
        />
        <p className="text-sm text-muted-foreground">
          {SERVE_SMS_SCHEDULE_COPY.sendTimeLine(timeZone)}
        </p>
        {estimatedCompletion && (
          <p className="text-sm text-muted-foreground">
            {SERVE_SMS_SCHEDULE_COPY.completionLine(
              fmtDate(estimatedCompletion),
            )}
          </p>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {SERVE_SMS_SCHEDULE_COPY.engagementHint}
      </p>
    </div>
  )
}

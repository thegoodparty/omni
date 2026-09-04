'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import {
  Alert,
  AlertDescription,
  Calendar,
  cn,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@styleguide'
import { CalendarIcon, InfoIcon } from '@styleguide/components/ui/icons'
import { Intro } from '../social/Intro'
import { combineScheduledAt, timeZoneShortLabel } from './scheduleTimeZone'

// Hourly 9:00 AM–7:00 PM, matching the design's time dropdown but without its
// "Send now"/"Custom time…" entries: robocalls carry a per-contact-timezone
// delivery window, so only in-window slots are offered. Capped at 7pm so a
// slot doesn't run into CallHub's daily calling cutoff undialed.
const TIME_SLOTS = Array.from({ length: 11 }, (_, i) => {
  const hour24 = 9 + i
  const value = `${String(hour24).padStart(2, '0')}:00`
  const hour12 = ((hour24 + 11) % 12) + 1
  const label = `${hour12}:00 ${hour24 < 12 ? 'AM' : 'PM'}`
  return { value, label }
})

// Selecting the last slot doesn't block sending, but calls placed that late
// may not all finish dialing before CallHub's cutoff.
const LATE_CUTOFF_TIME = '19:00'

interface RobocallScheduleStepProps {
  campaignName: string
  onCampaignNameChange: (value: string) => void
  scheduledDay: Date | undefined
  onScheduledDayChange: (day: Date | undefined) => void
  time: string
  onTimeChange: (time: string) => void
  timeZone: string
  // The earliest allowed send instant (now) and whether the current day+time
  // falls before it. Computed by the flow, which also gates the CTA.
  earliest: Date
  // The last selectable calendar day (now + the max schedule window), used to
  // grey out dates beyond it. Computed by the flow, which also gates the CTA.
  maxScheduledDay: Date
  violates: boolean
  // True when `violates` is due to the 85-day cap rather than a past time —
  // picks which message the shared Alert shows.
  isTooFarOut: boolean
}

export const RobocallScheduleStep = ({
  campaignName,
  onCampaignNameChange,
  scheduledDay,
  onScheduledDayChange,
  time,
  onTimeChange,
  timeZone,
  earliest,
  maxScheduledDay,
  violates,
  isTooFarOut,
}: RobocallScheduleStepProps) => {
  const [dateOpen, setDateOpen] = useState(false)

  return (
    <div className="space-y-6">
      <Intro
        title="When do you want to send it?"
        body="We recommend mid-morning or early evening for higher engagement."
      />

      <div className="space-y-2">
        <Label htmlFor="robocall-campaign-name">Campaign name</Label>
        <Input
          id="robocall-campaign-name"
          value={campaignName}
          onChange={(e) => onCampaignNameChange(e.target.value)}
          placeholder="e.g. Renter outreach — May"
          maxLength={60}
        />
        <p className="text-sm text-muted-foreground">
          Internal name to identify this campaign in your history.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="robocall-send-date">Send date</Label>
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <button
                id="robocall-send-date"
                type="button"
                className={cn(
                  'flex h-10 w-full items-center justify-between gap-2 rounded-md border bg-background px-3 text-sm',
                  violates ? 'border-destructive' : 'border-border',
                )}
              >
                <span
                  className={
                    scheduledDay ? 'text-foreground' : 'text-muted-foreground'
                  }
                >
                  {scheduledDay
                    ? format(scheduledDay, 'EEE, MMM d, yyyy')
                    : 'Pick a date'}
                </span>
                <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                selected={scheduledDay}
                disabled={{ after: maxScheduledDay }}
                onSelect={(day) => {
                  onScheduledDayChange(day ?? undefined)
                  setDateOpen(false)
                }}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-2">
          <Label htmlFor="robocall-send-time">Send time</Label>
          <Select value={time} onValueChange={onTimeChange}>
            <SelectTrigger id="robocall-send-time">
              <SelectValue placeholder="Select a time" />
            </SelectTrigger>
            <SelectContent>
              {TIME_SLOTS.map((slot) => (
                <SelectItem key={slot.value} value={slot.value}>
                  {slot.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            {timeZoneShortLabel(
              timeZone,
              combineScheduledAt(scheduledDay, time, timeZone) ?? earliest,
            )}
          </p>
        </div>
      </div>

      {violates && (
        <Alert variant="destructive">
          <AlertDescription>
            {isTooFarOut
              ? 'Pick a send date within the next 85 days.'
              : 'Pick a send date and time in the future.'}
          </AlertDescription>
        </Alert>
      )}

      {time === LATE_CUTOFF_TIME && (
        <Alert variant="info" icon={<InfoIcon className="size-4" />}>
          <AlertDescription>
            Calls scheduled for 7 PM may run past the day&apos;s calling cutoff.
            CallHub automatically sends any remaining calls the next morning.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

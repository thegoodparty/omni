'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
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
import { CalendarIcon } from '@styleguide/components/ui/icons'
import { Intro } from '../social/Intro'

// Hourly 9:00 AM–9:00 PM, matching the design's time dropdown but without its
// "Send now"/"Custom time…" entries: robocalls carry a hard lead time and a
// per-contact-timezone delivery window, so only in-window slots are offered.
const TIME_SLOTS = Array.from({ length: 13 }, (_, i) => {
  const hour24 = 9 + i
  const value = `${String(hour24).padStart(2, '0')}:00`
  const hour12 = ((hour24 + 11) % 12) + 1
  const label = `${hour12}:00 ${hour24 < 12 ? 'AM' : 'PM'}`
  return { value, label }
})

interface RobocallScheduleStepProps {
  campaignName: string
  onCampaignNameChange: (value: string) => void
  scheduledDay: Date | undefined
  onScheduledDayChange: (day: Date | undefined) => void
  time: string
  onTimeChange: (time: string) => void
  timeZone: string
  minLeadHours: number
  // The earliest allowed send instant (now + lead time) and whether the current
  // day+time falls before it. Computed by the flow, which also gates the CTA.
  earliest: Date
  violates: boolean
}

export const RobocallScheduleStep = ({
  campaignName,
  onCampaignNameChange,
  scheduledDay,
  onScheduledDayChange,
  time,
  onTimeChange,
  timeZone,
  minLeadHours,
  earliest,
  violates,
}: RobocallScheduleStepProps) => {
  const [dateOpen, setDateOpen] = useState(false)
  const earliestLabel = formatInTimeZone(earliest, timeZone, 'MMM d, h:mm a')

  return (
    <div className="space-y-6">
      <Intro
        channel="robocall"
        title="When do you want to send it?"
        body={`We recommend mid-morning or early evening for higher engagement. Sends require at least ${minLeadHours} hours' notice.`}
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
                onSelect={(day) => {
                  onScheduledDayChange(day ?? undefined)
                  setDateOpen(false)
                }}
              />
            </PopoverContent>
          </Popover>
          <p className="text-sm text-muted-foreground">
            Earliest send: {earliestLabel}.
          </p>
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
          <p className="text-sm text-muted-foreground">{timeZone}</p>
        </div>
      </div>

      {violates && (
        <Alert variant="destructive">
          <AlertDescription>
            Sends need at least {minLeadHours} hours&apos; notice. Pick a date
            and time on or after {earliestLabel}.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

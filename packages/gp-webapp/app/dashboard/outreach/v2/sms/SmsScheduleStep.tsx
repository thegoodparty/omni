'use client'

import { useMemo, useState } from 'react'
import {
  Alert,
  AlertDescription,
  Button,
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
import {
  CalendarIcon,
  CircleAlertIcon,
  ClockIcon,
} from '@styleguide/components/ui/icons'
import { Intro } from '../social/Intro'

// 9:00 AM through 9:00 PM hourly, plus a custom time clamped by validation.
// "Send now" is deliberately absent (scheduling decision: 48h minimum).
export const TIME_OPTIONS: {
  id: string
  label: string
  time: string | null
}[] = [
  ...Array.from({ length: 13 }, (_, i) => {
    const hour24 = 9 + i
    const period = hour24 >= 12 ? 'PM' : 'AM'
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
    return {
      id: String(hour24),
      label: `${hour12}:00 ${period}`,
      time: `${String(hour24).padStart(2, '0')}:00`,
    }
  }),
  { id: 'custom', label: 'Custom time…', time: null },
]

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

const fmtDateTime = (d: Date) =>
  `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`

interface SmsScheduleStepProps {
  name: string
  onNameChange: (value: string) => void
  date: Date | undefined
  onDateChange: (date: Date | undefined) => void
  timeSlot: string
  onTimeSlotChange: (value: string) => void
  customTime: string
  onCustomTimeChange: (value: string) => void
  earliestSend: number
  violates48h: boolean
  outsideWindow: boolean
}

export const SmsScheduleStep = ({
  name,
  onNameChange,
  date,
  onDateChange,
  timeSlot,
  onTimeSlotChange,
  customTime,
  onCustomTimeChange,
  earliestSend,
  violates48h,
  outsideWindow,
}: SmsScheduleStepProps) => {
  const [calOpen, setCalOpen] = useState(false)
  const tz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return 'Local time'
    }
  }, [])
  const earliestDay = useMemo(() => {
    const d = new Date(earliestSend)
    d.setHours(0, 0, 0, 0)
    return d
  }, [earliestSend])

  return (
    <div className="space-y-6">
      <Intro
        channel="text"
        title="When do you want to send it?"
        body="We recommend mid-morning or early evening for higher engagement. Sends require at least 48 hours' notice."
      />

      <div className="space-y-2">
        <Label htmlFor="sms-name">Campaign name</Label>
        <Input
          id="sms-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Renter outreach — May"
          maxLength={60}
        />
        <p className="text-sm text-muted-foreground">
          Internal name to identify this campaign in your history.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Send date</Label>
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className={cn(
                  'w-full justify-start rounded-md border-components-input-border bg-components-input-base px-3 text-base font-normal text-foreground hover:bg-muted md:text-sm',
                  !date && 'text-muted-foreground',
                )}
                aria-invalid={violates48h}
              >
                <CalendarIcon className="size-4 text-muted-foreground" />
                {date ? fmtDate(date) : 'Pick a date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                selected={date}
                onSelect={(d) => {
                  onDateChange(d ?? undefined)
                  setCalOpen(false)
                }}
                disabled={(day) => day < earliestDay}
              />
              <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                Dates inside the 48-hour window can&apos;t be scheduled.
              </div>
            </PopoverContent>
          </Popover>
          <p className="text-sm text-muted-foreground">
            Earliest send: {fmtDateTime(new Date(earliestSend))}.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Send time</Label>
          <Select value={timeSlot} onValueChange={onTimeSlotChange}>
            <SelectTrigger className="w-full" aria-invalid={violates48h}>
              <ClockIcon className="size-4 text-muted-foreground" />
              <SelectValue placeholder="Select time" />
            </SelectTrigger>
            <SelectContent>
              {TIME_OPTIONS.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {timeSlot === 'custom' && (
            <Input
              type="time"
              value={customTime}
              onChange={(e) => onCustomTimeChange(e.target.value)}
            />
          )}
          <p className="text-sm text-muted-foreground">{tz}</p>
        </div>
      </div>

      {violates48h && (
        <Alert variant="destructive" icon={<CircleAlertIcon />}>
          <AlertDescription>
            Sends need at least 48 hours&apos; notice. Pick a date and time on
            or after {fmtDateTime(new Date(earliestSend))}.
          </AlertDescription>
        </Alert>
      )}
      {!violates48h && outsideWindow && (
        <Alert variant="destructive" icon={<CircleAlertIcon />}>
          <AlertDescription>
            Send times must be between 9:00 AM and 9:00 PM.
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

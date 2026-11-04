import { useMemo, useState } from 'react'
import { EMAIL_SEND_WINDOW_DAYS } from '@goodparty_org/contracts'
import {
  Alert,
  AlertDescription,
  Button,
  Calendar,
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
import { timeZoneCaption } from '../sms/SmsScheduleStep'
import { CUSTOM_SLOT, emailTimeOptions } from './emailFlow.util'
import type { EmailSurface } from './emailSurface'

interface EmailScheduleStepProps {
  surface: EmailSurface
  date: Date
  timeSlot: string
  customTime: string
  error: string | null
  onDateChange: (value: Date) => void
  onTimeSlotChange: (value: string) => void
  onCustomTimeChange: (value: string) => void
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

export const EmailScheduleStep = ({
  surface,
  date,
  timeSlot,
  customTime,
  error,
  onDateChange,
  onTimeSlotChange,
  onCustomTimeChange,
}: EmailScheduleStepProps) => {
  const [calOpen, setCalOpen] = useState(false)
  // The send time is read in the browser's zone, so the caption names it.
  const tz = useMemo(
    () => timeZoneCaption(Intl.DateTimeFormat().resolvedOptions().timeZone),
    [],
  )
  const [firstDay, lastDay] = useMemo(() => {
    const first = new Date()
    first.setHours(0, 0, 0, 0)
    const last = new Date(first)
    last.setDate(last.getDate() + EMAIL_SEND_WINDOW_DAYS)
    return [first, last]
  }, [])
  const options = emailTimeOptions(date)

  const pickDate = (next: Date) => {
    onDateChange(next)
    // A slot the new day doesn't offer is cleared, never swapped for another.
    if (timeSlot && !emailTimeOptions(next).some((o) => o.value === timeSlot)) {
      onTimeSlotChange('')
    }
  }

  return (
    <div className="space-y-6">
      <Intro title={surface.schedule.title} body={surface.schedule.caption} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="email-send-date">Send date</Label>
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <Button
                id="email-send-date"
                type="button"
                variant="outline"
                className="w-full justify-start rounded-md border-components-input-border bg-components-input-base px-3 text-base font-normal text-foreground hover:bg-muted md:text-sm"
              >
                <CalendarIcon className="size-4 text-muted-foreground" />
                {fmtDate(date)}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                selected={date}
                defaultMonth={date}
                onSelect={(d) => {
                  if (d) pickDate(d)
                  setCalOpen(false)
                }}
                disabled={(day) => day < firstDay || day > lastDay}
              />
            </PopoverContent>
          </Popover>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email-send-time">Send time</Label>
          <Select value={timeSlot} onValueChange={onTimeSlotChange}>
            <SelectTrigger id="email-send-time" className="w-full">
              <ClockIcon className="size-4 text-muted-foreground" />
              <SelectValue placeholder="Select time" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {timeSlot === CUSTOM_SLOT && (
            <Input
              type="time"
              aria-label="Custom time"
              value={customTime}
              onChange={(e) => onCustomTimeChange(e.target.value)}
            />
          )}
          <p className="text-sm text-muted-foreground">{tz}</p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" icon={<CircleAlertIcon />}>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

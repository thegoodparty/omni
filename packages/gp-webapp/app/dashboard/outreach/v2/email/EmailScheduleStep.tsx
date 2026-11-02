import { EMAIL_SEND_WINDOW_DAYS } from '@goodparty_org/contracts'
import { Alert, AlertDescription, Button, Input, Label } from '@styleguide'
import { CircleAlertIcon } from '@styleguide/components/ui/icons'
import { Intro } from '../social/Intro'
import { toDateInput } from './emailFlow.util'
import type { EmailSurface } from './emailSurface'

interface EmailScheduleStepProps {
  surface: EmailSurface
  sendNow: boolean
  day: string
  time: string
  error: string | null
  onSendNowChange: (value: boolean) => void
  onDayChange: (value: string) => void
  onTimeChange: (value: string) => void
}

export const EmailScheduleStep = ({
  surface,
  sendNow,
  day,
  time,
  error,
  onSendNowChange,
  onDayChange,
  onTimeChange,
}: EmailScheduleStepProps) => {
  const today = new Date()
  const latest = new Date(today)
  latest.setDate(latest.getDate() + EMAIL_SEND_WINDOW_DAYS)

  return (
    <div className="space-y-6">
      <Intro title={surface.schedule.title} body={surface.schedule.caption} />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={sendNow ? 'default' : 'outline'}
          aria-pressed={sendNow}
          onClick={() => onSendNowChange(true)}
        >
          Send it as soon as it&apos;s paid
        </Button>
        <Button
          type="button"
          variant={sendNow ? 'outline' : 'default'}
          aria-pressed={!sendNow}
          onClick={() => onSendNowChange(false)}
        >
          Pick a day and time
        </Button>
      </div>

      {!sendNow && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="email-send-day">Day</Label>
            <Input
              id="email-send-day"
              type="date"
              min={toDateInput(today)}
              max={toDateInput(latest)}
              value={day}
              onChange={(e) => onDayChange(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email-send-time">Time</Label>
            <Input
              id="email-send-time"
              type="time"
              value={time}
              onChange={(e) => onTimeChange(e.target.value)}
            />
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive" icon={<CircleAlertIcon />}>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

import { OUTREACH_EVENT_LOCATION_MAX_LENGTH } from '@goodparty_org/contracts'
import { Input, Label } from '@styleguide'
import { Intro } from './social/Intro'
import {
  EVENT_DETAILS_TITLE,
  eventDateHasPassed,
  type EventDetailsDraft,
} from './eventDetails'

interface EventDetailsStepProps {
  details: EventDetailsDraft
  onChange: (details: EventDetailsDraft) => void
  // What the details end up in, for the caption: "message", "call script".
  destination: string
  prefillNote: string | null
  // Door knocking draws its own stage intro, so it passes false.
  showIntro?: boolean
}

export const EventDetailsStep = ({
  details,
  onChange,
  destination,
  prefillNote,
  showIntro = true,
}: EventDetailsStepProps) => {
  const set = (patch: Partial<EventDetailsDraft>) =>
    onChange({ ...details, ...patch })
  const datePassed = eventDateHasPassed(details.date)

  return (
    <div className="space-y-6">
      {showIntro ? (
        <Intro
          title={EVENT_DETAILS_TITLE}
          body={prefillNote ?? `We'll put these in your ${destination}.`}
        />
      ) : prefillNote ? (
        <p className="text-base text-muted-foreground">{prefillNote}</p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="event-date">Date</Label>
          <Input
            id="event-date"
            type="date"
            value={details.date}
            onChange={(e) => set({ date: e.target.value })}
            aria-invalid={datePassed}
          />
          {datePassed ? (
            <p className="text-sm text-destructive">
              That date has passed. Pick an upcoming one.
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="event-time">Start time</Label>
          <Input
            id="event-time"
            type="time"
            value={details.time}
            onChange={(e) => set({ time: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="event-location">Location</Label>
        <Input
          id="event-location"
          value={details.location}
          onChange={(e) => set({ location: e.target.value })}
          placeholder="e.g. Public library community room"
          maxLength={OUTREACH_EVENT_LOCATION_MAX_LENGTH}
        />
      </div>
    </div>
  )
}

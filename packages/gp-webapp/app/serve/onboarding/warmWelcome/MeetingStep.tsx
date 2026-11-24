import { useState } from 'react'
import { format, startOfDay } from 'date-fns'
import { Button } from '@styleguide'
import {
  CalendarIcon,
  CheckIcon,
  MapPinIcon,
} from '@styleguide/components/ui/icons'
import { cn } from '@styleguide/lib/utils'
import {
  calendarLinks,
  clockRange,
  longDay,
  meetingTitle,
  pickedMeeting,
  type CalendarId,
  type CalendarLink,
  type FirstMeeting,
} from './firstMeeting'
import { MeetingDatePicker, type PickedDate } from './MeetingDatePicker'
import {
  countWords,
  EntranceOffset,
  Rise,
  useEntranceOffset,
  useHandoff,
  Words,
} from './Reveal'
import { useDock, type DockAction } from './WarmWelcomeShell'
import { WARM_WELCOME_COPY, type AccentTitle } from './warmWelcomeConfig'

// What the official said about the meeting we found: it is right, it is on
// another day, or they do not know yet.
export type MeetingAnswer =
  | { kind: 'confirmed'; meeting: FirstMeeting }
  | { kind: 'corrected'; meeting: FirstMeeting }
  | { kind: 'unknown'; meeting: null }

type MeetingView = 'ask' | 'calendar' | 'pick' | 'find'

const DOCK_DELAY_MS: Record<MeetingView, number> = {
  ask: 2300,
  calendar: 1800,
  pick: 900,
  find: 1400,
}

// A headline's parts for Words: the accent arrives as one word, in the
// accent color.
const accentParts = (title: AccentTitle): React.ReactNode[] => [
  title.lead ? `${title.lead} ` : null,
  <span key="accent" className="text-primary">
    {title.accent}
  </span>,
  title.tail ? ` ${title.tail}` : null,
]

// Where the meeting is: the place in bold, the rest of the line under it.
const Place = ({ location }: { location: string }): React.JSX.Element => {
  const comma = location.indexOf(',')
  const place = comma > 0 ? location.slice(0, comma) : location
  const rest = comma > 0 ? location.slice(comma + 1).trim() : ''
  return (
    <div className="flex w-full max-w-[470px] items-center gap-3 rounded-[14px] bg-card p-4 text-left shadow-lg">
      <MapPinIcon className="size-5 flex-none text-primary" aria-hidden />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="ww-heading">{place}</span>
        {rest && <span className="ww-small text-muted-foreground">{rest}</span>}
      </div>
    </div>
  )
}

const CalendarCard = ({
  meeting,
  added,
  onAdd,
}: {
  meeting: FirstMeeting
  added: CalendarLink | null
  onAdd: (link: CalendarLink) => void
}): React.JSX.Element => {
  const copy = WARM_WELCOME_COPY.meeting
  const [links] = useState(() => calendarLinks(meeting))
  return (
    <div className="flex w-full max-w-[440px] flex-col gap-3.5 rounded-[14px] bg-card px-[18px] py-4 text-left shadow-lg">
      <div className="flex items-center gap-4">
        <div className="flex w-16 flex-none flex-col items-center rounded-[10px] border border-base-border bg-muted pt-2 pb-2.5">
          <span className="ww-caption font-bold tracking-[0.06em] text-brand-red-500 uppercase">
            {format(meeting.day, 'MMM')}
          </span>
          <b className="font-outfit text-[28px] leading-[1.1]">
            {format(meeting.day, 'd')}
          </b>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="ww-heading">{meetingTitle(meeting)}</span>
          <span className="ww-small text-muted-foreground">
            {longDay(meeting.day)}, {clockRange(meeting)}
          </span>
          {meeting.location && (
            <span className="ww-small text-muted-foreground">
              {meeting.location}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2.5 border-t border-base-border pt-3.5">
        {links.map((link) => (
          <Button
            key={link.id}
            asChild
            size="small"
            variant={added?.id === link.id ? 'default' : 'outline'}
          >
            <a
              href={link.href}
              onClick={() => onAdd(link)}
              {...(link.download
                ? { download: copy.calendarFile(meetingTitle(meeting)) }
                : { target: '_blank', rel: 'noopener noreferrer' })}
            >
              {added?.id === link.id ? (
                <CheckIcon aria-hidden />
              ) : (
                <CalendarIcon aria-hidden />
              )}
              {link.label}
            </a>
          </Button>
        ))}
      </div>
      <div className={cn('ww-fold', added && 'ww-fold-open')}>
        <div>
          <p
            className="ww-small flex items-center gap-2 font-semibold text-success"
            role="status"
          >
            {added && (
              <>
                <CheckIcon className="size-4 flex-none" aria-hidden />
                {added.download
                  ? copy.calendarSaved(added.calendarName)
                  : copy.calendarOpened(added.calendarName)}
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}

// Step 2: the first meeting. We say the date we found and ask if it is
// right. Yes leads to a calendar card; no leads to a date they can change,
// or to "I don't know yet".
export const MeetingStep = ({
  found,
  onAnswer,
  onNext,
}: {
  found: FirstMeeting
  onAnswer: (answer: MeetingAnswer) => void
  onNext: (calendar: CalendarId | null) => void
}): React.JSX.Element => {
  const copy = WARM_WELCOME_COPY.meeting
  const stepOffset = useEntranceOffset()
  const [view, setView] = useState<MeetingView>('ask')
  const [meeting, setMeeting] = useState(found)
  const [picked, setPicked] = useState<PickedDate>({
    day: found.day,
    startMinutes: found.startMinutes,
  })
  const [added, setAdded] = useState<CalendarLink | null>(null)
  const { shown, leaving, entered } = useHandoff(view)

  const go = (next: MeetingView): void => {
    if (!leaving) setView(next)
  }

  const actions: Record<MeetingView, DockAction[]> = {
    ask: [
      {
        key: 'no',
        label: copy.no,
        kind: 'secondary',
        onClick: () => go('pick'),
      },
      {
        key: 'yes',
        label: copy.yes,
        kind: 'primary',
        onClick: () => {
          setMeeting(found)
          setAdded(null)
          onAnswer({ kind: 'confirmed', meeting: found })
          go('calendar')
        },
      },
    ],
    calendar: [
      {
        key: 'next',
        label: copy.calendarNext,
        kind: 'primary',
        onClick: () => onNext(added?.id ?? null),
      },
    ],
    pick: [
      {
        key: 'unknown',
        label: copy.unknown,
        kind: 'quiet',
        onClick: () => {
          onAnswer({ kind: 'unknown', meeting: null })
          go('find')
        },
      },
      {
        key: 'use',
        label: copy.usePicked,
        kind: 'primary',
        onClick: () => {
          const corrected = pickedMeeting(
            found,
            picked.day,
            picked.startMinutes,
          )
          setMeeting(corrected)
          setAdded(null)
          onAnswer({ kind: 'corrected', meeting: corrected })
          go('calendar')
        },
      },
    ],
    find: [
      {
        key: 'next',
        label: copy.findNext,
        kind: 'primary',
        onClick: () => onNext(null),
      },
    ],
  }
  useDock(`meeting-${shown}`, DOCK_DELAY_MS[shown], actions[shown])

  const askTitle = copy.askTitle(found)
  const calendarTitle = copy.calendarTitle(meeting)

  return (
    <div
      className={cn(
        'flex w-full max-w-[960px] flex-col items-center gap-5 text-center',
        leaving ? 'ww-sub-out' : entered && 'ww-sub-in',
      )}
    >
      <EntranceOffset value={entered ? 0 : stepOffset}>
        {shown === 'ask' && (
          <>
            <h1 className="ww-title max-w-[26ch]">
              <Words>{accentParts(askTitle)}</Words>
            </h1>
            {found.location && (
              <Rise delay={1500} className="flex w-full justify-center">
                <Place location={found.location} />
              </Rise>
            )}
            <Rise delay={2000}>
              <p className="ww-prompt">{copy.askPrompt}</p>
            </Rise>
          </>
        )}
        {shown === 'calendar' && (
          <>
            <Rise delay={300} className="flex w-full justify-center">
              <CalendarCard meeting={meeting} added={added} onAdd={setAdded} />
            </Rise>
            <h1 className="ww-title">
              <Words delay={500}>{accentParts(calendarTitle)}</Words>
            </h1>
            <p className="ww-prompt">
              <Words
                delay={1100}
                index={1 + countWords(calendarTitle.tail ?? '')}
              >
                {copy.calendarPrompt}
              </Words>
            </p>
          </>
        )}
        {shown === 'pick' && (
          <>
            <h1 className="ww-title">
              <Words>{copy.pickTitle}</Words>
            </h1>
            <Rise delay={500}>
              <MeetingDatePicker
                value={picked}
                today={startOfDay(new Date())}
                onChange={setPicked}
              />
            </Rise>
          </>
        )}
        {shown === 'find' && (
          <>
            <h1 className="ww-title">
              <Words delay={150}>{copy.findTitle}</Words>
            </h1>
            <p className="ww-lede max-w-[52ch] text-muted-foreground">
              <Words delay={700} index={countWords(copy.findTitle)}>
                {copy.findLede}
              </Words>
            </p>
          </>
        )}
      </EntranceOffset>
    </div>
  )
}

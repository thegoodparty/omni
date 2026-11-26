import { useState } from 'react'
import { format, startOfDay } from 'date-fns'
import {
  CalendarIcon,
  CheckIcon,
  MapPinIcon,
} from '@styleguide/components/ui/icons'
import { DateSentence, type PickedDate } from './DateSentence'
import {
  calendarLinks,
  clockRange,
  longDay,
  meetingPlace,
  meetingTitle,
  pickedMeeting,
  type CalendarId,
  type CalendarLink,
  type FirstMeeting,
} from './firstMeeting'
import { PlaceThumb, useMeetingPoint } from './maps'
import { btnClass, cx } from './parts'
import {
  countWords,
  EntranceOffset,
  handoffClass,
  useEntranceOffset,
  useHandoff,
  useRise,
  Words,
} from './Reveal'
import { useDock, type DockAction } from './WarmWelcomeShell'
import {
  WARM_WELCOME_COPY,
  type AccentTitle,
  type OfficeWords,
} from './warmWelcomeConfig'

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
export const accentParts = (title: AccentTitle): React.ReactNode[] => [
  title.lead ? `${title.lead} ` : null,
  <span key="accent" className="em">
    {title.accent}
  </span>,
  title.tail ? ` ${title.tail}` : null,
]

export const accentWords = (title: AccentTitle): number =>
  countWords(title.lead ?? '') + 1 + countWords(title.tail ?? '')

// Where the meeting is, with a small map of it: the place in bold, the
// street and city under it, and the room on its own line.
const Place = ({
  meeting,
  town,
  delay,
}: {
  meeting: FirstMeeting
  // The office's own town, so the address is looked up in the right one.
  town: string | null
  delay: number
}): React.JSX.Element | null => {
  const at = meetingPlace(meeting.location)
  const point = useMeetingPoint(
    town && !meeting.location.includes(town)
      ? `${meeting.location}, ${town}`
      : meeting.location,
  )
  const rise = useRise(delay)
  if (!at) return null
  return (
    <div className="gcard loc ui" style={rise}>
      {point && <PlaceThumb point={point} />}
      <div className="addr">
        <b>
          <MapPinIcon className="i" aria-hidden />
          <span>{at.place}</span>
        </b>
        {at.address && <span>{at.address}</span>}
      </div>
    </div>
  )
}

const CalendarCard = ({
  meeting,
  added,
  onAdd,
  delay,
}: {
  meeting: FirstMeeting
  added: CalendarLink | null
  onAdd: (link: CalendarLink) => void
  delay: number
}): React.JSX.Element => {
  const copy = WARM_WELCOME_COPY.meeting
  const [links] = useState(() =>
    calendarLinks(meeting, copy.calendarDetails(meeting)),
  )
  const rise = useRise(delay)
  const at = meetingPlace(meeting.location)
  const street = at?.address.split(',')[0]?.trim()
  return (
    <div className="gcard calcard ui" style={rise}>
      <div className="top">
        <div className="datebox">
          <span>{format(meeting.day, 'MMM')}</span>
          <b>{format(meeting.day, 'd')}</b>
        </div>
        <div className="ev">
          <b>{meetingTitle(meeting)}</b>
          <span>
            {longDay(meeting.day)}, {clockRange(meeting)}
          </span>
          {at && <span>{[at.place, street].filter(Boolean).join(', ')}</span>}
        </div>
      </div>
      <div className="foot2">
        {links.map((link) => {
          const on = added?.id === link.id
          return (
            <a
              key={link.id}
              className={cx(btnClass('outline', 'sm'), on && 'on')}
              href={link.href}
              onClick={() => onAdd(link)}
              {...(link.download
                ? { download: copy.calendarFile(meetingTitle(meeting)) }
                : { target: '_blank', rel: 'noopener noreferrer' })}
            >
              {on ? (
                <CheckIcon className="i" aria-hidden />
              ) : (
                <CalendarIcon className="i" aria-hidden />
              )}
              {link.label}
            </a>
          )
        })}
      </div>
      <p className="done" role="status" hidden={!added}>
        <CheckIcon className="i" aria-hidden />
        <span>
          {added &&
            (added.download
              ? copy.calendarSaved(added.calendarName)
              : copy.calendarOpened(added.calendarName))}
        </span>
      </p>
    </div>
  )
}

// Step 2: the first meeting. We say the date we found and ask if it is
// right. Yes leads to a calendar card; no leads to a date they can change,
// or to "I don't know yet".
export const MeetingStep = ({
  found,
  words,
  town,
  saving,
  onAnswer,
  onNext,
}: {
  found: FirstMeeting
  words: OfficeWords
  town: string | null
  // A corrected date is on its way to gp-api.
  saving: boolean
  // Resolves false when a corrected date could not be saved.
  onAnswer: (answer: MeetingAnswer) => Promise<boolean>
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
  const handoff = useHandoff(view)
  const { shown, leaving, entered } = handoff
  const offset = entered ? 0 : stepOffset

  const go = (next: MeetingView): void => {
    if (!leaving) setView(next)
  }

  const answer = async (
    next: MeetingAnswer,
    then: MeetingView,
  ): Promise<void> => {
    if (leaving || saving) return
    if (!(await onAnswer(next))) return
    if (next.meeting) {
      setMeeting(next.meeting)
      setAdded(null)
    }
    setView(then)
  }

  const actions: Record<MeetingView, DockAction[]> = {
    ask: [
      {
        key: 'no',
        label: copy.no,
        kind: 'outline',
        onClick: () => go('pick'),
      },
      {
        key: 'yes',
        label: copy.yes,
        kind: 'primary',
        disabled: saving,
        onClick: () =>
          void answer({ kind: 'confirmed', meeting: found }, 'calendar'),
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
        kind: 'link',
        disabled: saving,
        onClick: () => void answer({ kind: 'unknown', meeting: null }, 'find'),
      },
      {
        key: 'use',
        label: copy.usePicked,
        kind: 'primary',
        disabled: saving,
        onClick: () => {
          // Leaving the sentence as we found it is a yes.
          const unchanged =
            picked.day.getTime() === found.day.getTime() &&
            picked.startMinutes === found.startMinutes
          void answer(
            unchanged
              ? { kind: 'confirmed', meeting: found }
              : {
                  kind: 'corrected',
                  meeting: pickedMeeting(
                    found,
                    picked.day,
                    picked.startMinutes,
                  ),
                },
            'calendar',
          )
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
  useDock(`meeting-${shown}`, offset + DOCK_DELAY_MS[shown], actions[shown])

  const askTitle = copy.askTitle(found)
  const calendarTitle = copy.calendarTitle(meeting)

  return (
    <div className="wrap">
      <EntranceOffset value={offset}>
        {shown === 'ask' && (
          <div className={cx('col center', handoffClass(handoff))}>
            <h1 style={{ maxWidth: '26ch' }}>
              <Words>{accentParts(askTitle)}</Words>
            </h1>
            <Place meeting={found} town={town} delay={1500} />
            <AskPrompt index={accentWords(askTitle)} />
          </div>
        )}
        {shown === 'calendar' && (
          <div
            className={cx('col', handoffClass(handoff))}
            style={{ alignItems: 'center', textAlign: 'center' }}
          >
            <CalendarCard
              meeting={meeting}
              added={added}
              onAdd={setAdded}
              delay={300}
            />
            <h1>
              <Words delay={500}>{accentParts(calendarTitle)}</Words>
            </h1>
            <p className="lede prompt">
              <Words delay={1100} index={accentWords(calendarTitle)}>
                {copy.calendarPrompt}
              </Words>
            </p>
          </div>
        )}
        {shown === 'pick' && (
          <div className={cx('col center', handoffClass(handoff))}>
            <h1>
              <Words>{copy.pickTitle}</Words>
            </h1>
            <DateSentence
              value={picked}
              today={startOfDay(new Date())}
              onChange={setPicked}
            />
          </div>
        )}
        {shown === 'find' && (
          <div className={cx('col center', handoffClass(handoff))}>
            <h1>
              <Words delay={150}>{copy.findTitle}</Words>
            </h1>
            <p className="lede">
              <Words delay={700} index={countWords(copy.findTitle)}>
                {copy.findLede(words)}
              </Words>
            </p>
          </div>
        )}
      </EntranceOffset>
    </div>
  )
}

const AskPrompt = ({ index }: { index: number }): React.JSX.Element => {
  const rise = useRise(2000)
  return (
    <p className="lede prompt ui" style={rise}>
      <Words index={index}>{WARM_WELCOME_COPY.meeting.askPrompt}</Words>
    </p>
  )
}

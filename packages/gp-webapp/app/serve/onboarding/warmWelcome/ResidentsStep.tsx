import { useEffect, useRef, useState } from 'react'
import { startOfDay } from 'date-fns'
import { MANAGED_INVITE_LOCKED_LINES } from 'app/dashboard/outreach/v2/sms/smsCompose.util'
import { parseDay, toDayString } from './firstMeeting'
import { VoicesMap, type MapVoice } from './maps'
import { Ocean } from './Ocean'
import {
  canSendOn,
  earliestSend,
  latestSend,
  sendDayLong,
  sendHourLabel,
  sendOptions,
  type SendChoice,
} from './panelDays'
import { cx, Tap, vars } from './parts'
import {
  countWords,
  EntranceOffset,
  handoffClass,
  useEntranceOffset,
  useHandoff,
  useRise,
  Words,
} from './Reveal'
import { Sky } from './Sky'
import { useDock, type DockAction } from './WarmWelcomeShell'
import { WARM_WELCOME_COPY } from './warmWelcomeConfig'

export type ResidentsView = 'see' | 'ask' | 'invite' | 'when' | 'done'

// What the Civic Panel offer needs: how many residents the district's panel
// aims for, when texts go out, and how far ahead the first can be.
export interface PanelOffer {
  goal: number
  sendHour: number
  maxDaysOut: number
}

export interface PanelSetup {
  // The part of the invite the official can change, as they left it.
  chunk: string
  firstSend: Date
  choice: SendChoice
  edited: boolean
}

const DOCK_DELAY_MS: Record<ResidentsView, number> = {
  see: 5700,
  ask: 5400,
  invite: 2000,
  when: 0,
  done: 1800,
}

// The invite as it looks in Messages: a blue bubble with a tail, a dateline
// and Delivered. The greeting and the closing lines are locked; the middle
// is theirs to change.
const Invite = ({
  chunk,
  editing,
  onChange,
}: {
  chunk: string
  editing: boolean
  onChange: (next: string) => void
}): React.JSX.Element => {
  const copy = WARM_WELCOME_COPY.residents
  const rise = useRise(1200)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const chunkRef = useRef<HTMLSpanElement>(null)
  // The text the field was given, so typing never moves the caret.
  const [seed] = useState(chunk)

  useEffect(() => {
    const field = chunkRef.current
    if (!editing || !field) return
    // Where plain-text editing is not supported, the field is still editable.
    if (!field.isContentEditable) field.setAttribute('contenteditable', 'true')
    field.focus()
    const range = document.createRange()
    range.selectNodeContents(field)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    const timer = setTimeout(
      () =>
        bubbleRef.current?.scrollIntoView?.({
          block: 'center',
          behavior: 'smooth',
        }),
      320,
    )
    return () => clearTimeout(timer)
  }, [editing])

  return (
    <div
      className="imsg ui"
      style={rise}
      role="group"
      aria-label={copy.inviteAlt}
    >
      <div className="ihead">
        <span className="av" aria-hidden>
          {copy.resident.charAt(0)}
        </span>
        <span>{copy.resident}</span>
      </div>
      <div className="itime">{copy.inviteTime}</div>
      <div className="brow">
        <div className={cx('bubble', editing && 'editing')} ref={bubbleRef}>
          <span className="locked">{copy.greeting(copy.resident)}</span>
          <span
            className="chunk"
            ref={chunkRef}
            role="textbox"
            aria-multiline="true"
            aria-label={copy.chunkLabel}
            aria-readonly={!editing}
            contentEditable={editing ? 'plaintext-only' : undefined}
            suppressContentEditableWarning
            onInput={(event) => onChange(event.currentTarget.textContent ?? '')}
          >
            {seed}
          </span>
          <span className="locked">
            {`\n\n${copy.pledge}\n\n${MANAGED_INVITE_LOCKED_LINES}`}
          </span>
        </div>
      </div>
      <span className="idel">{copy.delivered}</span>
    </div>
  )
}

// Step 4: residents. What people nearby are saying, on a map of the
// official's own town, then the offer of a Civic Panel and its three short
// screens: the text, the day, and the confirmation.
export const ResidentsStep = ({
  voices,
  syntheticCount,
  place,
  offer,
  panelDay,
  startAt,
  inviteChunk,
  swornIn,
  saving,
  onSetUp,
  onNext,
}: {
  voices: MapVoice[]
  syntheticCount: number
  place: string | null
  // Null when a Civic Panel cannot be offered to this office.
  offer: PanelOffer | null
  // The day the invites start, once a panel is set up.
  panelDay: Date | null
  // Where to open: the map, or straight on the ask.
  startAt: 'see' | 'ask'
  // The invite's starting text; `elect` says who they are until sworn in.
  inviteChunk: (elect: boolean) => string
  swornIn: Date | null
  saving: boolean
  // Resolves false when the panel could not be set up.
  onSetUp: (setup: PanelSetup) => Promise<boolean>
  onNext: (outcome: {
    panel: 'set_up' | 'skipped' | 'unavailable'
    sawComments: boolean
    edited: boolean
    choice: SendChoice | null
  }) => void
}): React.JSX.Element => {
  const copy = WARM_WELCOME_COPY.residents
  const stepOffset = useEntranceOffset()
  const hasVoices = voices.length > 0
  const [initial] = useState<ResidentsView>(() => {
    if (panelDay && (startAt === 'ask' || !hasVoices)) return 'done'
    return startAt === 'see' && hasVoices ? 'see' : 'ask'
  })
  const [view, setView] = useState<ResidentsView>(initial)
  const handoff = useHandoff(view)
  const { shown, leaving, entered } = handoff
  const offset = entered ? 0 : stepOffset
  const [today] = useState(() => startOfDay(new Date()))

  const [draft] = useState(() => inviteChunk(true))
  const [chunk, setChunk] = useState(draft)
  const [editing, setEditing] = useState(false)
  const [choice, setChoice] = useState<SendChoice | null>(null)
  const [day, setDay] = useState<Date | null>(null)
  const [options] = useState(() =>
    offer
      ? sendOptions({
          today,
          swornIn,
          sendHour: offer.sendHour,
          maxDaysOut: offer.maxDaysOut,
        })
      : [],
  )
  const sentDay = panelDay ?? day

  const go = (next: ResidentsView): void => {
    if (!leaving) setView(next)
  }
  const outcome = (panel: 'set_up' | 'skipped' | 'unavailable') => ({
    panel,
    sawComments: hasVoices && initial === 'see',
    edited: chunk !== draft,
    choice,
  })
  const afterMap = (): void => {
    if (!offer) {
      onNext(outcome('unavailable'))
      return
    }
    go(panelDay ? 'done' : 'ask')
  }

  const setUp = async (): Promise<void> => {
    if (!day || !choice || saving || leaving) return
    // An invite that still names them as elect is sent as they will be on
    // the day: once they are sworn in, the "-elect" goes.
    const sworn = swornIn !== null && day.getTime() >= swornIn.getTime()
    const text = sworn && chunk === draft ? inviteChunk(false) : chunk
    const ok = await onSetUp({
      chunk: text,
      firstSend: day,
      choice,
      edited: chunk !== draft,
    })
    if (ok) setView('done')
  }

  const actions: Record<ResidentsView, DockAction[]> = {
    see: [
      { key: 'next', label: copy.next, kind: 'primary', onClick: afterMap },
    ],
    ask: [
      {
        key: 'skip',
        label: copy.skip,
        kind: 'link',
        onClick: () => onNext(outcome('skipped')),
      },
      {
        key: 'yes',
        label: copy.yes,
        kind: 'primary',
        onClick: () => go('invite'),
      },
    ],
    invite: [
      {
        key: 'edit',
        label: editing ? copy.doneEditing : copy.edit,
        kind: editing ? 'primary' : 'outline',
        className: cx('iv-edit', editing && 'on'),
        content: (
          <>
            <span className="l1" aria-hidden={editing}>
              {copy.edit}
            </span>
            <span className="l2" aria-hidden={!editing}>
              {copy.doneEditing}
            </span>
          </>
        ),
        onClick: () => setEditing((on) => !on),
      },
      {
        key: 'day',
        label: copy.pickDay,
        kind: 'primary',
        className: cx('iv-send', editing && 'out'),
        disabled: chunk.trim().length === 0,
        onClick: () => {
          setEditing(false)
          go('when')
        },
      },
    ],
    when: day
      ? [
          {
            key: 'back',
            label: copy.backToText,
            kind: 'link',
            onClick: () => go('invite'),
          },
          {
            key: 'go',
            label: copy.setUp,
            kind: 'primary',
            disabled: saving,
            onClick: () => void setUp(),
          },
        ]
      : [],
    done: [
      {
        key: 'next',
        label: copy.doneNext,
        kind: 'primary',
        onClick: () => onNext(outcome('set_up')),
      },
    ],
  }
  useDock(
    shown === 'when'
      ? `residents-when-${day ? 'set' : 'open'}`
      : `residents-${shown}`,
    offset + DOCK_DELAY_MS[shown],
    actions[shown],
  )

  const mapTitle = copy.mapTitle(place)
  const askLede = offer ? copy.askLede(offer.goal, place) : ''
  const doneTitle = sentDay ? copy.doneTitle(sendDayLong(sentDay)) : ''

  return (
    <div className="wrap center">
      <EntranceOffset value={offset}>
        {shown === 'see' && (
          <div className={cx('col center', handoffClass(handoff))}>
            <VoicesMap
              voices={voices}
              place={place}
              startDelayMs={entered ? 500 : 900}
            />
            {syntheticCount > 0 && (
              <MapNote>
                {syntheticCount >= voices.length
                  ? copy.allSynthetic
                  : copy.someSynthetic}
              </MapNote>
            )}
            <h1 style={{ maxWidth: '24ch' }}>
              <Words delay={600}>{mapTitle}</Words>
            </h1>
          </div>
        )}
        {shown === 'ask' && offer && (
          <div className={cx('col center', handoffClass(handoff))}>
            <AskOcean />
            <h1 style={{ maxWidth: '18ch' }}>
              <Words delay={3900}>{copy.askTitle}</Words>
            </h1>
            <p className="lede" style={{ maxWidth: '56ch' }}>
              <Words delay={4500} index={countWords(copy.askTitle)}>
                {askLede}
              </Words>
            </p>
          </div>
        )}
        {shown === 'invite' && (
          <div
            className={cx('col center ls-invite', handoffClass(handoff))}
            style={{ gap: 16 }}
          >
            <h1>
              <Words delay={150}>{copy.inviteTitle}</Words>
            </h1>
            <p className="lede" style={{ maxWidth: '60ch' }}>
              <Words delay={600} index={countWords(copy.inviteTitle)}>
                {`${copy.inviteLede} `}
                <span>{copy.inviteLedeEnd}</span>
              </Words>
            </p>
            <Invite chunk={chunk} editing={editing} onChange={setChunk} />
          </div>
        )}
        {shown === 'when' && offer && (
          <div
            className={cx('col center', handoffClass(handoff))}
            style={{ gap: 18 }}
          >
            <h1 style={{ maxWidth: '20ch' }}>
              <Words delay={150}>{copy.whenTitle}</Words>
            </h1>
            <p className="lede" style={{ maxWidth: '40ch' }}>
              <Words delay={600} index={countWords(copy.whenTitle)}>
                {copy.whenLede(sendHourLabel(offer.sendHour), place)}
              </Words>
            </p>
            <DayChips
              options={options}
              choice={choice}
              onPick={(option) => {
                setChoice(option.key)
                setDay(option.date)
              }}
            />
            <Tip />
            <div className={cx('fold', choice !== 'pick' && 'off')}>
              <div>
                <label className="dlab">
                  {copy.startDate}
                  <input
                    type="date"
                    min={toDayString(earliestSend(today))}
                    max={toDayString(latestSend(today, offer.maxDaysOut))}
                    value={choice === 'pick' && day ? toDayString(day) : ''}
                    onChange={(event) => {
                      const picked = parseDay(event.target.value)
                      setDay(
                        picked && canSendOn(picked, today, offer.maxDaysOut)
                          ? picked
                          : null,
                      )
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
        )}
        {shown === 'done' && (
          <div className={cx('col center', handoffClass(handoff))}>
            <Sky />
            <h1 style={{ maxWidth: '22ch' }}>
              <Words delay={600}>{doneTitle}</Words>
            </h1>
            <p className="lede" style={{ maxWidth: '40ch' }}>
              <Words delay={1100} index={countWords(doneTitle)}>
                {copy.doneLede}
              </Words>
            </p>
          </div>
        )}
      </EntranceOffset>
    </div>
  )
}

const MapNote = ({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element => (
  <p className="mapnote ui" style={useRise(1500)}>
    {children}
  </p>
)

const AskOcean = (): React.JSX.Element => <Ocean style={useRise(150)} />

const Tip = (): React.JSX.Element => {
  const copy = WARM_WELCOME_COPY.residents
  return (
    <div className="tip ui" style={useRise(1600)}>
      <b>{copy.tipLabel}</b>
      <span>{copy.tip}</span>
    </div>
  )
}

// The start day as a row of chips, a few sensible days and then any day.
// Nothing is preselected.
const DayChips = ({
  options,
  choice,
  onPick,
}: {
  options: ReturnType<typeof sendOptions>
  choice: SendChoice | null
  onPick: (option: ReturnType<typeof sendOptions>[number]) => void
}): React.JSX.Element => {
  const offset = useEntranceOffset()
  return (
    <div
      className="days ui"
      role="radiogroup"
      aria-label={WARM_WELCOME_COPY.residents.startDay}
      style={useRise(1100)}
    >
      {options.map((option, index) => (
        <Tap
          key={option.key}
          className={cx('day ui', choice === option.key && 'on')}
          role="radio"
          aria-checked={choice === option.key}
          style={vars({ '--d': `${offset + 1100 + 90 * index}ms` })}
          onClick={() => onPick(option)}
        >
          <span className="d1">{option.label}</span>
          <span className="d2">{option.sub}</span>
        </Tap>
      ))}
    </div>
  )
}

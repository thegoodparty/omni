import { Fragment } from 'react'
import {
  DoorKnockingRoutePayload,
  RoutePayloadAddress,
  RoutePayloadStop,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'
import {
  OUTCOME_OPTIONS,
  OUTCOME_QUESTION,
  SUPPORT_OPTIONS,
  SUPPORT_QUESTION,
  WILL_VOTE_OPTIONS,
  WILL_VOTE_QUESTION,
} from '../native/knockQuestions'
import { STATUS_LABELS } from '../native/statusPresentation'

const formatDuration = (seconds: number): string => {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`
}

const formatDistance = (meters: number): string =>
  `${(meters / 1609.344).toFixed(1)} mi`

// Age and party are the two things a canvasser uses to open a conversation,
// and they're the only enrichment worth the ink.
const describeTarget = (target: RoutePayloadTarget): string =>
  [
    target.age === null ? null : `${target.age}`,
    target.politicalParty,
    target.mayHaveMoved ? 'may have moved' : null,
  ]
    .filter(Boolean)
    .join(' · ')

// An empty square to tick. Printers drop background colors by default, so
// every mark on this page has to be a border or text.
const Box = ({ label }: { label: string }) => (
  <span className="inline-flex items-center gap-1 whitespace-nowrap">
    <span className="inline-block h-3 w-3 border border-black" aria-hidden />
    {label}
  </span>
)

const Question = ({
  question,
  options,
}: {
  question: string
  options: Array<[string, string]>
}) => (
  <>
    <span className="font-semibold">{question}</span>
    {options.map(([value, label]) => (
      <Box key={value} label={label} />
    ))}
  </>
)

const QuestionRow = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
    {children}
  </div>
)

const targetsOf = (stop: RoutePayloadStop): RoutePayloadTarget[] =>
  stop.addresses.flatMap((address) => address.targets)

const TargetBlock = ({ target }: { target: RoutePayloadTarget }) => {
  const detail = describeTarget(target)
  // Already recorded in the app: print the answer instead of blank boxes, so
  // a door isn't knocked twice and a transcriber doesn't overwrite it.
  const recorded = target.knockStatus !== 'unknown'

  return (
    <div className="break-inside-avoid px-2 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold">
          {target.name ?? 'Name unavailable'}
        </span>
        {detail && <span className="text-[10px]">{detail}</span>}
      </div>
      {recorded ? (
        <div className="text-[10px] italic">
          Already logged: {STATUS_LABELS[target.knockStatus]}
        </div>
      ) : (
        <div className="mt-1 flex flex-col gap-1">
          <QuestionRow>
            <Question question={OUTCOME_QUESTION} options={OUTCOME_OPTIONS} />
          </QuestionRow>
          {/* The two follow-ups only apply to an answered door and share a
              line: a 150-stop route is already a stack of paper. */}
          <QuestionRow>
            <Question question={SUPPORT_QUESTION} options={SUPPORT_OPTIONS} />
            <Question
              question={WILL_VOTE_QUESTION}
              options={WILL_VOTE_OPTIONS}
            />
          </QuestionRow>
          <div className="flex items-end gap-1 text-[10px]">
            <span className="font-semibold">Notes</span>
            <span className="h-4 flex-1 border-b border-dotted border-neutral-500" />
          </div>
        </div>
      )}
    </div>
  )
}

const residentNames = (address: RoutePayloadAddress): string[] =>
  address.otherResidents
    .map((resident) => resident.name)
    .filter((name): name is string => Boolean(name))

// One stop can hold several addresses — a walkable multi-unit building routes
// as a single stop with one address per unit. Every block inside a stop is a
// flat sibling under `divide-y`, so the rules between them are drawn by the
// container: nothing has to know whether it's first, and no two borders can
// stack into the double line an earlier `first:` modifier failed to prevent.
const StopBlock = ({ stop }: { stop: RoutePayloadStop }) => {
  // With one address the stop header already names it, so repeating the line
  // per unit is noise. With several, the unit is the only thing telling a
  // canvasser which door to knock.
  const perUnit = stop.addresses.length > 1

  return (
    <li className="break-inside-avoid divide-y divide-neutral-300 border border-neutral-400">
      <div className="flex items-baseline gap-2 px-2 py-1">
        <span className="text-sm font-bold tabular-nums">{stop.seq}</span>
        <span className="flex-1 text-xs font-semibold">
          {stop.displayAddress}
        </span>
        {stop.legSeconds > 0 && (
          <span className="text-[10px] tabular-nums">
            {formatDuration(stop.legSeconds)} from last
          </span>
        )}
      </div>
      {stop.addresses.map((address) => (
        <Fragment key={address.addressKey}>
          {perUnit && (
            <div className="px-2 py-0.5 text-[10px] font-semibold">
              {address.address}
            </div>
          )}
          {address.targets.map((target) => (
            <TargetBlock key={target.stopTargetId} target={target} />
          ))}
          {residentNames(address).length > 0 && (
            <div className="px-2 py-1 text-[10px]">
              Also at {perUnit ? address.address : 'this address'}:{' '}
              {residentNames(address).join(', ')}
            </div>
          )}
        </Fragment>
      ))}
    </li>
  )
}

interface WalkSheetProps {
  turfName: string
  payload: DoorKnockingRoutePayload
}

// The paper fallback for a walk with no signal: the same route the walk view
// shows, laid out to be written on and transcribed back afterwards. It is
// deliberately a server component with no interactivity — a canvasser hitting
// this URL on a phone with one bar should get a printable page, not a
// hydration wait.
export default function WalkSheet({ turfName, payload }: WalkSheetProps) {
  const stops = payload.stops.slice().sort((a, b) => a.seq - b.seq)
  const doorCount = stops.reduce((sum, stop) => sum + targetsOf(stop).length, 0)

  return (
    <div className="mx-auto max-w-3xl bg-white p-6 text-black print:max-w-none print:p-0">
      <div className="mb-4 rounded border border-neutral-400 p-3 text-sm print:hidden">
        <p className="font-semibold">
          Print this page (Ctrl+P, or ⌘P on a Mac), then take it with you.
        </p>
        <p className="mt-1">
          Write the answers as you knock. When you&rsquo;re back in signal, open
          the list in the app and log each door — nothing on paper reaches your
          voter records on its own.
        </p>
      </div>

      <header className="mb-3 border-b-2 border-black pb-2">
        <h1 className="text-lg font-bold">{turfName}</h1>
        <p className="text-xs">
          {stops.length} stops · {doorCount} doors ·{' '}
          {payload.route.mode === 'walk' ? 'Walking' : 'Driving'}
          {payload.route.loop ? ' loop' : ''} ·{' '}
          {formatDuration(payload.route.totalSeconds)} ·{' '}
          {formatDistance(payload.route.totalMeters)}
        </p>
        {/* Deliberately no printed date. This renders in Node, whose clock is
            UTC, so an evening print anywhere in the US would be stamped
            tomorrow — and formatting it as UTC only makes the wrong date a
            consistent one. The canvasser dates the sheet, which is both
            accurate and what people already do with paper. */}
        <p className="flex items-baseline gap-1.5 text-[10px]">
          <span className="flex-1">
            Answers already logged in the app are printed below; anything logged
            after this was printed won&rsquo;t be.
          </span>
          <span className="font-semibold">Date walked</span>
          <span className="inline-block w-20 border-b border-neutral-500" />
        </p>
      </header>

      {stops.length === 0 ? (
        <p className="text-sm">This route has no stops.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {stops.map((stop) => (
            <StopBlock key={stop.id} stop={stop} />
          ))}
        </ol>
      )}

      <p className="mt-4 border-t border-neutral-400 pt-2 text-[10px]">
        Log these doors in the app when you&rsquo;re back online — this sheet
        doesn&rsquo;t update your voter records.
      </p>
    </div>
  )
}

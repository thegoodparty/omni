import {
  CIVIC_PANEL_PAGE_HREF,
  MAX_LIST_SAMPLE_SIZE,
  PANEL_CALL_ASSUMED_JOIN_RATE,
  PANEL_CALLS_PER_HOUR,
  PANEL_DOOR_ASSUMED_JOIN_RATE,
  PANEL_DOOR_SHARE_OF_HOURS,
  PANEL_DOORS_PER_AREA,
  PANEL_DOORS_PER_HOUR,
  PANEL_MAX_DOOR_AREAS,
  PANEL_SEED_ASSUMED_JOIN_RATE,
  PANEL_TEXT_REPLY_BUSINESS_DAYS,
  PANEL_UNSTARTED_STEP_DAYS,
  PANEL_WEEKS_PER_WAVE,
  type CivicPanelBuildChannel,
  type CivicPanelBuildNext,
  type CivicPanelBuildStepStatus,
  type GeoJsonPolygon,
  type UnderrepresentedGroup,
} from '@goodparty_org/contracts'
import { addDays, format, isBefore, subBusinessDays } from 'date-fns'

export type PlannedStep = {
  channel: CivicPanelBuildChannel
  position: number
  targetSize: number
}

// Who each channel can still reach: residents with a cell phone, with any
// phone, and anyone at all, after every exclusion.
export type PanelWavePools = { text: number; phone: number; door: number }

export const CHANNEL_ORDER: CivicPanelBuildChannel[] = [
  'text',
  'phone_banking',
  'door_knocking',
]

// How many asks it takes to expect `joins` yeses. Rounded to six places
// first so float noise (94.5 / 0.03 = 3150.0000000000005) never asks one
// more person than the math says.
export const asksFor = (joins: number, rate: number) =>
  Math.ceil(Number((joins / rate).toFixed(6)))

// One wave, sized to the members still missing. Doors and calls spend about
// a month of the official's weekly time (doors take their share up to two
// walkable areas, the rest goes to calls) and are never sized past what the
// gap needs; texts cover whatever gap the calls and doors are not expected
// to fill. A channel nobody can be reached on gets no step.
export const sizePanelWave = ({
  gap,
  hoursPerWeek,
  pools,
}: {
  gap: number
  hoursPerWeek: number
  pools: PanelWavePools
}): PlannedStep[] => {
  if (gap <= 0) return []
  const hours = hoursPerWeek * PANEL_WEEKS_PER_WAVE
  const doorHours = hours * PANEL_DOOR_SHARE_OF_HOURS
  const doors = Math.max(
    0,
    Math.min(
      Math.floor(doorHours * PANEL_DOORS_PER_HOUR),
      PANEL_DOORS_PER_AREA * PANEL_MAX_DOOR_AREAS,
      pools.door,
      asksFor(gap, PANEL_DOOR_ASSUMED_JOIN_RATE),
    ),
  )
  const callHours = hours - doors / PANEL_DOORS_PER_HOUR
  const callGap = gap - doors * PANEL_DOOR_ASSUMED_JOIN_RATE
  const calls =
    callGap <= 0
      ? 0
      : Math.max(
          0,
          Math.min(
            Math.floor(callHours * PANEL_CALLS_PER_HOUR),
            pools.phone,
            asksFor(callGap, PANEL_CALL_ASSUMED_JOIN_RATE),
          ),
        )
  const textGap = callGap - calls * PANEL_CALL_ASSUMED_JOIN_RATE
  const texts =
    textGap <= 0
      ? 0
      : Math.min(
          asksFor(textGap, PANEL_SEED_ASSUMED_JOIN_RATE),
          pools.text,
          MAX_LIST_SAMPLE_SIZE,
        )
  const areas = doors > PANEL_DOORS_PER_AREA ? 2 : 1
  const firstArea = Math.ceil(doors / areas)
  const steps: PlannedStep[] = [
    { channel: 'text', position: 1, targetSize: texts },
    { channel: 'phone_banking', position: 1, targetSize: calls },
    { channel: 'door_knocking', position: 1, targetSize: firstArea },
    { channel: 'door_knocking', position: 2, targetSize: doors - firstArea },
  ]
  return steps.filter((step) => step.targetSize > 0)
}

const METERS_PER_DEGREE_LAT = 110_540
const METERS_PER_DEGREE_LNG_AT_EQUATOR = 111_320

const AREA_PADDING_METERS = 50

// The box around the picked households, padded so the corner doors sit
// inside it: what a turf's map opens on.
export const areaAround = (
  points: { lat: number; lng: number }[],
): GeoJsonPolygon | null => {
  if (points.length === 0) return null
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  const padLat = AREA_PADDING_METERS / METERS_PER_DEGREE_LAT
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2
  const padLng =
    AREA_PADDING_METERS /
    (METERS_PER_DEGREE_LNG_AT_EQUATOR * Math.cos((midLat * Math.PI) / 180))
  const minLat = Math.min(...lats) - padLat
  const maxLat = Math.max(...lats) + padLat
  const minLng = Math.min(...lngs) - padLng
  const maxLng = Math.max(...lngs) + padLng
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat],
      ],
    ],
  }
}

export type StepTimeline = {
  channel: CivicPanelBuildChannel
  startedAt: Date | null
  completedAt: Date | null
  expectedRepliesBy: Date | null
  skippedAt: Date | null
}

// A step's status from what the plan read last wrote onto it. `superseded`
// is true once a later wave exists. A skip only holds while nothing was
// started from the step: a list used anyway reads as what was done with it.
export const stepStatus = (
  step: StepTimeline,
  superseded: boolean,
  now: Date,
): CivicPanelBuildStepStatus => {
  if (step.completedAt) return 'done'
  if (!step.startedAt) {
    return step.skippedAt || superseded ? 'skipped' : 'not_started'
  }
  if (step.channel !== 'text' || !step.expectedRepliesBy) return 'in_progress'
  const sendsOn = subBusinessDays(
    step.expectedRepliesBy,
    PANEL_TEXT_REPLY_BUSINESS_DAYS,
  )
  return isBefore(now, sendsOn) ? 'in_progress' : 'waiting_on_replies'
}

// Whether the next wave can go: every step is done or skipped, or the rest
// of the wave is done and whatever nobody started has waited long enough.
// Skipping every step asks for the next wave straight away.
export const waveIsDue = (
  wave: (StepTimeline & { status: CivicPanelBuildStepStatus })[],
  now: Date,
): boolean => {
  if (wave.length === 0) return false
  const steps = wave.filter((s) => s.status !== 'skipped')
  if (steps.length === 0) return true
  if (steps.some((s) => s.status !== 'done' && s.status !== 'not_started')) {
    return false
  }
  const done = steps.filter((s) => s.status === 'done')
  if (done.length === steps.length) return true
  if (done.length === 0) return false
  const lastDone = done.reduce(
    (latest, s) =>
      s.completedAt && s.completedAt > latest ? s.completedAt : latest,
    new Date(0),
  )
  return !isBefore(now, addDays(lastDone, PANEL_UNSTARTED_STEP_DAYS))
}

const READY_LINES: Record<CivicPanelBuildChannel, string> = {
  text: 'Invite residents to your civic panel by text',
  phone_banking: 'Call residents to invite them to your civic panel',
  door_knocking: 'Knock on doors to invite residents to your civic panel',
}

// A door step that walks a part of the district the panel has barely
// reached says so. Never which part, or why.
const STEERED_DOOR_LINE =
  "Knock on doors in a part of your district we haven't reached"

const IN_PROGRESS_LINES: Record<CivicPanelBuildChannel, string> = {
  text: 'Your civic panel invite is on its way',
  phone_banking: 'Finish your civic panel calls',
  door_knocking: 'Finish knocking on doors for your civic panel',
}

const dayOf = (date: Date) => format(date, 'EEEE, MMMM d')

// The one thing to do next, from the current wave: a step nobody has
// started (texts first), else one being worked, else the replies to wait
// for. Null when the wave holds nothing left to do or wait on.
export const nextStep = (
  steps: (StepTimeline & {
    id: string
    position: number
    status: CivicPanelBuildStepStatus
    steeredToward?: UnderrepresentedGroup | null
  })[],
): CivicPanelBuildNext | null => {
  const ordered = [...steps].sort(
    (a, b) =>
      CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel) ||
      a.position - b.position,
  )
  const href = (id: string) => `${CIVIC_PANEL_PAGE_HREF}?step=${id}`
  const ready = ordered.find((s) => s.status === 'not_started')
  if (ready) {
    return {
      stepId: ready.id,
      channel: ready.channel,
      status: ready.status,
      line:
        ready.channel === 'door_knocking' &&
        ready.steeredToward === 'unreachedAreas'
          ? STEERED_DOOR_LINE
          : READY_LINES[ready.channel],
      href: href(ready.id),
    }
  }
  const working = ordered.find((s) => s.status === 'in_progress')
  if (working) {
    const sendsOn =
      working.channel === 'text' && working.expectedRepliesBy
        ? subBusinessDays(
            working.expectedRepliesBy,
            PANEL_TEXT_REPLY_BUSINESS_DAYS,
          )
        : null
    return {
      stepId: working.id,
      channel: working.channel,
      status: working.status,
      line: sendsOn
        ? `Your civic panel invite goes out ${dayOf(sendsOn)}`
        : IN_PROGRESS_LINES[working.channel],
      href: working.channel === 'text' ? null : href(working.id),
    }
  }
  const waiting = ordered.find(
    (s) => s.status === 'waiting_on_replies' && s.expectedRepliesBy,
  )
  if (waiting?.expectedRepliesBy) {
    return {
      stepId: waiting.id,
      channel: waiting.channel,
      status: waiting.status,
      line: `Replies to your civic panel invite should be in by ${dayOf(waiting.expectedRepliesBy)}`,
      href: null,
    }
  }
  return null
}

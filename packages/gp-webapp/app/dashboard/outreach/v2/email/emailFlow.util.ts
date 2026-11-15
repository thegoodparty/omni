import {
  EMAIL_SEND_WINDOW_DAYS,
  type EmailDraft,
  type EmailDraftSaveContent,
} from '@goodparty_org/contracts'
import {
  composeIssues,
  fromContent,
  hasIssues,
  lookStepIssue,
  toContent,
  writeStepIssues,
  type EmailComposeState,
} from './emailForm.util'
import type { EmailSurface } from './emailSurface'

export const EMAIL_STEP_ORDER = [
  'goal',
  'audience',
  'write',
  'look',
  'schedule',
  'review',
  'pay',
] as const
export type EmailStep = (typeof EMAIL_STEP_ORDER)[number]

export const emailDraftHref = (id: number): string =>
  `/dashboard/outreach/email?draft=${id}`

// The warming ladder from the TDD, indexed by the sender's `warmingStep`.
const WARMING_CAPS = [1_000, 5_000, 25_000, 100_000, 250_000] as const

export const nextWarmingCap = (warmingStep: number): number | null =>
  WARMING_CAPS[warmingStep + 1] ?? null

export const formatCount = (count: number): string =>
  count.toLocaleString('en-US')

export const toDraftSave = (
  goal: string,
  state: EmailComposeState,
  id: number | null,
  date: string | undefined,
  listId: number | null,
): EmailDraftSaveContent => ({
  ...(id !== null ? { id } : {}),
  goal,
  content: toContent(state),
  ...(date ? { date } : {}),
  ...(listId !== null ? { voterFileFilterId: listId } : {}),
})

const pad = (n: number): string => String(n).padStart(2, '0')

export const toDateInput = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export type ScheduleCheck =
  | { ok: true; iso: string | undefined }
  | { ok: false; message: string }

// A time at or before now leaves the date off: the send goes out once it is
// paid.
export const checkSchedule = (
  day: string,
  time: string,
  now: Date = new Date(),
): ScheduleCheck => {
  if (!day || !time) return { ok: false, message: 'Pick a day and a time.' }
  const when = new Date(`${day}T${time}`)
  if (Number.isNaN(when.getTime())) {
    return { ok: false, message: 'Pick a day and a time.' }
  }
  if (when.getTime() <= now.getTime()) return { ok: true, iso: undefined }
  const latest = new Date(now)
  latest.setDate(latest.getDate() + EMAIL_SEND_WINDOW_DAYS)
  if (when.getTime() > latest.getTime()) {
    return {
      ok: false,
      message: `Pick a day within the next ${EMAIL_SEND_WINDOW_DAYS} days.`,
    }
  }
  return { ok: true, iso: when.toISOString() }
}

export const SEND_NOW_SLOT = 'now'
export const CUSTOM_SLOT = 'custom'

export interface TimeOption {
  value: string
  label: string
}

const hourLabel = (hour: number): string =>
  `${hour % 12 === 0 ? 12 : hour % 12}:00 ${hour >= 12 ? 'PM' : 'AM'}`

// Today offers sending once paid plus the hours still ahead; a later day
// offers every hour.
export const emailTimeOptions = (
  date: Date,
  now: Date = new Date(),
): TimeOption[] => {
  const isToday = toDateInput(date) === toDateInput(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const hours = Array.from({ length: 24 }, (_, hour) => hour).filter(
    (hour) => !isToday || hour * 60 > nowMinutes,
  )
  return [
    ...(isToday
      ? [{ value: SEND_NOW_SLOT, label: "As soon as it's paid" }]
      : []),
    ...hours.map((hour) => ({
      value: `${pad(hour)}:00`,
      label: hourLabel(hour),
    })),
    { value: CUSTOM_SLOT, label: 'Custom time…' },
  ]
}

export const checkScheduleSlot = (
  date: Date,
  slot: string,
  customTime: string,
  now: Date = new Date(),
): ScheduleCheck => {
  if (slot === SEND_NOW_SLOT) return { ok: true, iso: undefined }
  if (!slot) return { ok: false, message: 'Pick a time.' }
  const time = slot === CUSTOM_SLOT ? customTime : slot
  return checkSchedule(toDateInput(date), time, now)
}

export const formatDollars = (cents: number): string =>
  `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

export interface LoadedEmailDraft {
  step: EmailStep
  goalId: string | null
  customGoal: string
  compose: EmailComposeState
  listId: number | null
  sendDate: Date
  timeSlot: string
  customTime: string
}

// A saved draft back into the flow's state. Every save replaces the whole
// draft, so whatever is not read back here is erased by the next one. A send
// time that has passed reads as sending once paid.
export const loadEmailDraft = (
  draft: EmailDraft,
  surface: Pick<EmailSurface, 'goals' | 'customGoalId'>,
  now: Date = new Date(),
): LoadedEmailDraft => {
  const preset = surface.goals.find(
    (g) => g.id !== surface.customGoalId && g.label === draft.goal,
  )
  const goal = draft.goal.trim()
  const goalId = preset ? preset.id : goal ? surface.customGoalId : null
  const compose: EmailComposeState = fromContent(draft.content)
  const when = draft.date ? new Date(draft.date) : null
  const upcoming =
    when !== null &&
    !Number.isNaN(when.getTime()) &&
    when.getTime() > now.getTime()
  let schedule = { sendDate: now, timeSlot: SEND_NOW_SLOT, customTime: '' }
  if (upcoming) {
    const time = `${pad(when.getHours())}:${pad(when.getMinutes())}`
    const listed = emailTimeOptions(when, now).some((o) => o.value === time)
    schedule = listed
      ? { sendDate: when, timeSlot: time, customTime: '' }
      : { sendDate: when, timeSlot: CUSTOM_SLOT, customTime: time }
  }
  // A draft with no date can't say whether its time was picked, so it
  // opens on the schedule step.
  const step: EmailStep =
    goalId === null
      ? 'goal'
      : draft.voterFileFilterId === null
        ? 'audience'
        : hasIssues(writeStepIssues(compose, true))
          ? 'write'
          : hasIssues(composeIssues(compose, true)) ||
              lookStepIssue(compose) !== undefined
            ? 'look'
            : upcoming
              ? 'review'
              : 'schedule'
  return {
    step,
    goalId,
    customGoal: preset ? '' : goal,
    compose,
    listId: draft.voterFileFilterId,
    ...schedule,
  }
}

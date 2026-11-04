import {
  EMAIL_SEND_WINDOW_DAYS,
  type EmailDraftSaveContent,
} from '@goodparty_org/contracts'
import { toContent, type EmailComposeState } from './emailForm.util'

// The warming ladder from the TDD, indexed by the sender's `warmingStep`.
// gp-api freezes the real cap when the send is confirmed; this is the number
// the audience step can promise until then.
const WARMING_CAPS = [1_000, 5_000, 25_000, 100_000, 250_000] as const

export const warmingCap = (warmingStep: number): number =>
  WARMING_CAPS[Math.min(warmingStep, WARMING_CAPS.length - 1)] ??
  WARMING_CAPS[0]

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

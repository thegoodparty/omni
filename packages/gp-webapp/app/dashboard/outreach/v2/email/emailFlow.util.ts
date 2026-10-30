import {
  EMAIL_SEND_WINDOW_DAYS,
  type EmailDraftSaveContent,
} from '@goodparty_org/contracts'
import { toContent, type EmailComposeState } from './emailBlocks.util'

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
  audience: { listId: number | null; consent: boolean },
): EmailDraftSaveContent => ({
  ...(id !== null ? { id } : {}),
  goal,
  content: toContent(state),
  ...(date ? { date } : {}),
  ...(audience.listId !== null ? { voterFileFilterId: audience.listId } : {}),
  consentConfirmed: audience.consent,
})

const pad = (n: number): string => String(n).padStart(2, '0')

export const toDateInput = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export type ScheduleCheck =
  | { ok: true; iso: string | undefined }
  | { ok: false; message: string }

// `sendNow` leaves the date off: the send goes out once it is paid.
export const checkSchedule = (
  sendNow: boolean,
  day: string,
  time: string,
  now: Date = new Date(),
): ScheduleCheck => {
  if (sendNow) return { ok: true, iso: undefined }
  if (!day || !time) return { ok: false, message: 'Pick a day and a time.' }
  const when = new Date(`${day}T${time}`)
  if (Number.isNaN(when.getTime())) {
    return { ok: false, message: 'Pick a day and a time.' }
  }
  if (when.getTime() < now.getTime()) {
    return { ok: false, message: 'Pick a time that has not passed.' }
  }
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

export const formatDollars = (cents: number): string =>
  `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

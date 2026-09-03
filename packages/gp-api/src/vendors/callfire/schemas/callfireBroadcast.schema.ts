import { z } from 'zod'
import {
  ROBOCALL_BROADCAST_STATUS,
  RobocallBroadcastStatus,
} from '@/outreach/vendor/robocallVendor.types'

// A CallFire voice broadcast has a create-then-launch lifecycle. POST
// /calls/broadcasts?start=false creates it in a NON-DIALING (SETUP) state; a
// later, explicit POST /calls/broadcasts/{id}/start is the transition that
// actually places calls, so this slice — create + schedule — never sends it.
// Field names below are verified against the v2 Swagger (CallBroadcast +
// nested CallBroadcastSounds / LocalTimeRestriction / RetryConfig / Schedule).

// The audio played on pickup. A robocall must be a human recording (FCC), so
// only the pre-uploaded sound ids are set — never the text-to-speech
// `liveSoundText` CallFire also accepts here. `liveSoundId` plays to a live
// answer; `machineSoundId` to an answering machine (used when
// answeringMachineConfig routes to a machine message).
export const CallBroadcastSoundsSchema = z.object({
  liveSoundId: z.number(),
  machineSoundId: z.number().optional(),
})
export type CallBroadcastSounds = z.infer<typeof CallBroadcastSoundsSchema>

// Caps dialing to a legal daily window in the recipient's local time. Enabled
// with a 9am floor (stricter than the 8am legal floor) and a 9pm ceiling.
export const LocalTimeRestrictionSchema = z.object({
  enabled: z.boolean(),
  beginHour: z.number(),
  beginMinute: z.number(),
  endHour: z.number(),
  endMinute: z.number(),
})
export type LocalTimeRestriction = z.infer<typeof LocalTimeRestrictionSchema>

// LocalDate/LocalTime are CallFire's split date/time objects (not ISO
// strings). A Schedule bounds the campaign's dialing to a date range, days of
// week, and time-of-day window in `timeZone`.
export const LocalDateSchema = z.object({
  year: z.number(),
  month: z.number(),
  day: z.number(),
})
export const LocalTimeSchema = z.object({
  hour: z.number(),
  minute: z.number(),
})
export const ScheduleSchema = z.object({
  startDate: LocalDateSchema,
  stopDate: LocalDateSchema,
  startTimeOfDay: LocalTimeSchema,
  stopTimeOfDay: LocalTimeSchema,
  daysOfWeek: z.array(z.string()),
  timeZone: z.string(),
})
export type Schedule = z.infer<typeof ScheduleSchema>

// Which call results are retried and how often. Values are from CallFire's
// call-result enum (BUSY, NO_ANS, ...).
export const RetryConfigSchema = z.object({
  maxAttempts: z.number(),
  minutesBetweenAttempts: z.number(),
  retryResults: z.array(z.string()),
})
export type RetryConfig = z.infer<typeof RetryConfigSchema>

// How CallFire routes a machine vs live pickup.
export const CALLFIRE_ANSWERING_MACHINE_CONFIG = {
  AM_ONLY: 'AM_ONLY',
  AM_AND_LIVE: 'AM_AND_LIVE',
  LIVE_WITH_AMD: 'LIVE_WITH_AMD',
  LIVE_IMMEDIATE: 'LIVE_IMMEDIATE',
} as const

// The wire body for POST /calls/broadcasts?start=false. Inline `recipients`
// are optional — the audience is normally a validated contact list attached
// after create via the batches endpoint (see the service). CallFire returns
// far more on read; this is only what we send.
export const CreateBroadcastBodySchema = z.object({
  name: z.string(),
  fromNumber: z.string(),
  sounds: CallBroadcastSoundsSchema,
  answeringMachineConfig: z.string(),
  localTimeRestriction: LocalTimeRestrictionSchema,
  retryConfig: RetryConfigSchema,
  schedules: z.array(ScheduleSchema),
  recipients: z.array(z.object({ phoneNumber: z.string() })).optional(),
})
export type CreateBroadcastBody = z.infer<typeof CreateBroadcastBodySchema>

// The batches endpoint attaches an existing (validated) contact list to a
// broadcast: POST /calls/broadcasts/{id}/batches with a BatchRequest.
export const BatchRequestSchema = z.object({
  name: z.string(),
  contactListId: z.number(),
})
export type BatchRequest = z.infer<typeof BatchRequestSchema>

// Create / batches both return a bare ResourceId (the new broadcast/batch id).
export const ResourceIdSchema = z.object({
  id: z.number(),
})
export type ResourceId = z.infer<typeof ResourceIdSchema>

// GET /calls/broadcasts/{id}. Only the fields we act on; the rest is stripped.
// `status` is CallFire's native lifecycle code that maps to the neutral enum.
export const CallBroadcastSchema = z.object({
  id: z.number(),
  name: z.string().nullish(),
  status: z.string().nullish(),
  statusReason: z.string().nullish(),
})
export type CallBroadcast = z.infer<typeof CallBroadcastSchema>

// ─── Status mapping (the single source of truth) ────────────────────────────
// CallFire's CallBroadcast.status is a rich lifecycle enum. This is the ONE
// place it collapses into the vendor-neutral RobocallBroadcastStatus the send
// and completion state machines switch on. Any status not listed — including a
// value CallFire adds later — falls through to UNKNOWN, which callers treat as
// "not yet resolved", never as terminal.
//
//   pending   — created / scheduled / awaiting validation or approval, not yet
//               dialing (SETUP, SCHEDULED, START_PENDING, VALIDATING_*,
//               APPROVED, TEST)
//   dialing   — actively placing calls (RUNNING)
//   paused    — temporarily halted, resumable (PAUSED, SUSPENDED)
//   completed — finished dialing / archived (FINISHED, ARCHIVED)
//   aborted   — stopped or rejected, will not dial (STOPPED, CANCELED,
//               DECLINED, BLOCKED_SUSPICIOUS)
const CALLFIRE_STATUS_MAP: Record<string, RobocallBroadcastStatus> = {
  TEST: ROBOCALL_BROADCAST_STATUS.PENDING,
  SETUP: ROBOCALL_BROADCAST_STATUS.PENDING,
  START_PENDING: ROBOCALL_BROADCAST_STATUS.PENDING,
  SCHEDULED: ROBOCALL_BROADCAST_STATUS.PENDING,
  VALIDATING_START: ROBOCALL_BROADCAST_STATUS.PENDING,
  VALIDATING_EMAIL: ROBOCALL_BROADCAST_STATUS.PENDING,
  APPROVED: ROBOCALL_BROADCAST_STATUS.PENDING,
  RUNNING: ROBOCALL_BROADCAST_STATUS.DIALING,
  PAUSED: ROBOCALL_BROADCAST_STATUS.PAUSED,
  SUSPENDED: ROBOCALL_BROADCAST_STATUS.PAUSED,
  FINISHED: ROBOCALL_BROADCAST_STATUS.COMPLETED,
  ARCHIVED: ROBOCALL_BROADCAST_STATUS.COMPLETED,
  STOPPED: ROBOCALL_BROADCAST_STATUS.ABORTED,
  CANCELED: ROBOCALL_BROADCAST_STATUS.ABORTED,
  DECLINED: ROBOCALL_BROADCAST_STATUS.ABORTED,
  BLOCKED_SUSPICIOUS: ROBOCALL_BROADCAST_STATUS.ABORTED,
}

export const mapCallfireBroadcastStatus = (
  status: string | null | undefined,
): RobocallBroadcastStatus =>
  (status ? CALLFIRE_STATUS_MAP[status] : undefined) ??
  ROBOCALL_BROADCAST_STATUS.UNKNOWN

import { z } from 'zod'

// Stats for a call broadcast from GET /calls/broadcasts/{id}/stats. Fields are
// verified against the CallFire v2 Swagger (CallBroadcastStats) and the
// official Java SDK. CallFire may omit a zero-valued count, so every count is
// nullish here; the money-critical connected-count guard lives in
// CallfireResultsService.getCompletedCount, not in this shape.
export const CallBroadcastStatsSchema = z.object({
  callsLiveAnswer: z.number().int().nullish(),
  answeringMachineCount: z.number().int().nullish(),
  busyCount: z.number().int().nullish(),
  noAnswerCount: z.number().int().nullish(),
  errorCount: z.number().int().nullish(),
  billedAmount: z.number().nullish(),
  callsDuration: z.number().int().nullish(),
  totalOutboundCount: z.number().int().nullish(),
})
export type CallBroadcastStats = z.infer<typeof CallBroadcastStatsSchema>

// Known CallResult dispositions (the per-call finalCallResult). LA (live
// answer) is the disposition the connected count is defined against — see
// CallfireResultsService.getCompletedCount.
export const CALL_RESULT = {
  LIVE_ANSWER: 'LA',
  ANSWERING_MACHINE: 'AM',
  BUSY: 'BUSY',
  NO_ANSWER: 'NO_ANS',
  DO_NOT_CALL: 'DNC',
  TRANSFER: 'XFER',
} as const

// finalCallResult is read as a free string, not a z.enum: this audit path must
// not hard-fail on a disposition code CallFire adds to the enum later.
export const CallfireCallSchema = z.object({
  id: z.number().nullish(),
  toNumber: z.string().nullish(),
  finalCallResult: z.string().nullish(),
})
export type CallfireCall = z.infer<typeof CallfireCallSchema>

// The standard CallFire Page envelope. Per the Swagger Page docs, when
// items.length < limit there are no further pages.
export const CallPageSchema = z.object({
  items: z.array(CallfireCallSchema).nullish(),
  limit: z.number().int().nullish(),
  offset: z.number().int().nullish(),
  totalCount: z.number().int().nullish(),
})
export type CallPage = z.infer<typeof CallPageSchema>

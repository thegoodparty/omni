import { z } from 'zod'
import { GuardPickerStatusSchema } from './guardLedger'

// ENG-11593: the one channel judge-guard.yml (which decides the floor, the
// picker's additions and whether the picker itself ran) has to tell
// judge.yml's sweep job (which holds the AWS role and writes the ledger
// line) what it decided. Carried as a `workflow_dispatch` input —
// `judge-request.yml`'s own `guard_context`, threaded through unchanged to
// this file — because the two files communicate only through that dispatch
// (judge-guard.yml's header: "no AWS in judge-guard.yml").
//
// Three fields, deliberately no more: `floor` and `added` are how a picker
// miss gets found later (a case a human expected in `added` but the ledger
// shows only in `floor`, or not at all), and `picker` is the status the
// cap pricing already worked from. Never a placeholder — a sweep job that
// cannot tell the difference between "the picker added nothing" and "no one
// told it what the picker did" must refuse the line rather than guess.
export const GuardContextSchema = z.object({
  floor: z.array(z.string().min(1)),
  added: z.array(z.string().min(1)),
  picker: GuardPickerStatusSchema,
})
export type GuardContext = z.infer<typeof GuardContextSchema>

export class GuardContextError extends Error {}

export const parseGuardContext = (raw: string): GuardContext => {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (err) {
    throw new GuardContextError(
      `guard_context is not valid JSON — ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  const parsed = GuardContextSchema.safeParse(json)
  if (!parsed.success) {
    throw new GuardContextError(
      `guard_context is not a valid guard context — ${parsed.error.message}`,
    )
  }
  return parsed.data
}

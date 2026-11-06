import { format, parseISO, subMonths } from 'date-fns'
import { z } from 'zod'

// One line per guard sweep, appended by the judge.yml run the guard starts
// (that job holds the judge-sweep AWS role; judge-guard.yml itself never
// does — see that file's `permissions:` header). Every object this module
// touches lives under `_judge/`, the one prefix
// `infrastructure/modules/universal-judge-sweep-policy` actually grants:
// `_judge/guard/<yyyy-mm>.jsonl` for the ledger itself, and
// `_judge/guard/baselines/<agentId>.json` for a main-vs-main baseline
// (guardBaseline.ts). Implementation Notes 2.6.
export const GUARD_LEDGER_PREFIX = '_judge/guard'

export const ledgerKey = (yyyyMm: string): string =>
  `${GUARD_LEDGER_PREFIX}/${yyyyMm}.jsonl`

export const GuardLedgerStatusSchema = z.enum([
  'completed',
  'cancelled',
  'failed',
])
export type GuardLedgerStatus = z.infer<typeof GuardLedgerStatusSchema>

export const GuardSpendSourceSchema = z.enum(['report', 'estimate'])
export type GuardSpendSource = z.infer<typeof GuardSpendSourceSchema>

export const GuardPickerStatusSchema = z.enum(['ok', 'failed', 'capped'])
export type GuardPickerStatus = z.infer<typeof GuardPickerStatusSchema>

// The quality verdict label a swept agent landed on, plus the two outcomes
// that mean no verdict was reached (resultMapping.ts's GuardOutcome covers
// the same two for the check; a ledger line about one agent never needs
// 'no_agent_reached').
export const GuardLedgerVerdictSchema = z.enum([
  'BETTER',
  'WORSE',
  'SAME',
  "CAN'T SAY",
  'infra_error',
])
export type GuardLedgerVerdict = z.infer<typeof GuardLedgerVerdictSchema>

export const GuardRulingSchema = z.object({
  by: z.string().min(1),
  kind: z.enum(['agree', 'dispute']),
  reason: z.string().min(1),
})
export type GuardRuling = z.infer<typeof GuardRulingSchema>

// Matches Implementation Notes 2.6 field-for-field, plus `runId` and
// `recordedAt` — neither is in the TDD's example line, but both are what
// let a line be traced back to the run that wrote it and sorted into the
// right month file.
export const GuardLedgerLineSchema = z.object({
  pr: z.number().int().positive(),
  headSha: z.string().min(1),
  agents: z.array(z.string().min(1)),
  floor: z.array(z.string().min(1)),
  added: z.array(z.string().min(1)),
  verdicts: z.record(z.string(), GuardLedgerVerdictSchema),
  spendUsd: z.number().nonnegative(),
  pickerUsd: z.number().nonnegative(),
  status: GuardLedgerStatusSchema,
  spendSource: GuardSpendSourceSchema,
  baselineRunId: z.string().min(1).nullable(),
  picker: GuardPickerStatusSchema,
  ruling: GuardRulingSchema.nullable(),
  runId: z.string().min(1),
  recordedAt: z.string().datetime(),
})
export type GuardLedgerLine = z.infer<typeof GuardLedgerLineSchema>

export class GuardLedgerError extends Error {}

const parseLine = (where: string, text: string): GuardLedgerLine => {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (err) {
    throw new GuardLedgerError(
      `${where}: not valid JSON — ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  const parsed = GuardLedgerLineSchema.safeParse(json)
  if (!parsed.success) {
    throw new GuardLedgerError(
      `${where}: not a valid guard ledger line — ${parsed.error.message}`,
    )
  }
  return parsed.data
}

export const parseLedgerLines = (
  where: string,
  jsonl: string,
): GuardLedgerLine[] =>
  jsonl
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => parseLine(where, line))

export const monthKeyOf = (iso: string): string =>
  format(parseISO(iso), 'yyyy-MM')

// This month plus the `count - 1` before it, newest first. Two is enough for
// the one case that crosses a boundary (a PR open across a month-end); the
// cap check and `judge spend` both pass however many they need.
export const recentMonthKeys = (now: Date, count: number): string[] =>
  Array.from({ length: count }, (_, i) => format(subMonths(now, i), 'yyyy-MM'))

// Every ledger line for this PR counts toward its spend, whatever its
// status: a cancelled sweep already spent on the runs it captured before the
// cancellation landed, same as a completed one (Acceptance Criteria; the
// $50 cap exists precisely to bound a four-times-pushed PR, and a push
// cancels the run in progress — judge-guard.yml's concurrency note).
export const sumSpentCentsForPr = (
  lines: readonly GuardLedgerLine[],
  pr: number,
): number =>
  lines
    .filter((line) => line.pr === pr)
    .reduce(
      (cents, line) =>
        cents + Math.round((line.spendUsd + line.pickerUsd) * 100),
      0,
    )

// --- Storage: a tiny append-only JSONL object per month ---------------------
//
// S3 has no native append, so this is read-modify-write under an optimistic
// lock: write only `If-Match` the ETag just read (or `If-None-Match: *` for
// a month's first line), and retry the whole read-modify-write on a 412 —
// another guard run appended between this run's read and its write. Guard
// sweeps for different PRs can land in the same window; a sweep for one PR
// never blocks on another's write beyond a short retry.
export interface GuardLedgerPort {
  // Resolves to undefined for a key that does not exist yet — the normal
  // state for a month's first line, same contract records.ts documents for
  // its own store.
  getWithEtag: (
    key: string,
  ) => Promise<{ text: string; etag: string } | undefined>
  // `ifMatch: 'NONE'` asks for `If-None-Match: *` (the key must not exist).
  // Resolves 'conflict' on a failed precondition rather than throwing, so
  // the retry loop below reads as a loop and not an exception handler.
  putIfMatch: (
    key: string,
    text: string,
    ifMatch: string | 'NONE',
  ) => Promise<{ etag: string } | 'conflict'>
}

const MAX_APPEND_ATTEMPTS = 5

export const appendLedgerLine = async (
  port: GuardLedgerPort,
  line: GuardLedgerLine,
): Promise<void> => {
  const validated = GuardLedgerLineSchema.parse(line)
  const key = ledgerKey(monthKeyOf(validated.recordedAt))
  const serialized = `${JSON.stringify(validated)}\n`

  for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt++) {
    const current = await port.getWithEtag(key)
    const result = await port.putIfMatch(
      key,
      (current?.text ?? '') + serialized,
      current?.etag ?? 'NONE',
    )
    if (result !== 'conflict') return
  }
  throw new GuardLedgerError(
    `could not append to ${key} after ${MAX_APPEND_ATTEMPTS} attempts — ` +
      'another guard run kept winning the race',
  )
}

export const readLedgerMonth = async (
  port: GuardLedgerPort,
  yyyyMm: string,
): Promise<GuardLedgerLine[]> => {
  const key = ledgerKey(yyyyMm)
  const current = await port.getWithEtag(key)
  if (current === undefined) return []
  return parseLedgerLines(key, current.text)
}

// Same port, same optimistic-lock idiom as appendLedgerLine, for an object
// that replaces rather than grows — guardBaselineCli.ts's baseline file,
// which Implementation Notes 2.6 says is "replaced by the previous one"
// each time `judge baseline` runs for an agent. No caller contends over a
// baseline write in practice (it is a human running a CLI, not a fleet of
// guard sweeps), so the retry here is only ever insurance.
export const writeLedgerObject = async (
  port: GuardLedgerPort,
  key: string,
  text: string,
): Promise<void> => {
  for (let attempt = 1; attempt <= MAX_APPEND_ATTEMPTS; attempt++) {
    const current = await port.getWithEtag(key)
    const result = await port.putIfMatch(key, text, current?.etag ?? 'NONE')
    if (result !== 'conflict') return
  }
  throw new GuardLedgerError(
    `could not write ${key} after ${MAX_APPEND_ATTEMPTS} attempts`,
  )
}

export const readLedgerObject = async (
  port: GuardLedgerPort,
  key: string,
): Promise<string | undefined> => (await port.getWithEtag(key))?.text

export const readLedgerMonths = async (
  port: GuardLedgerPort,
  yyyyMms: readonly string[],
): Promise<GuardLedgerLine[]> => {
  const months = await Promise.all(
    yyyyMms.map((yyyyMm) => readLedgerMonth(port, yyyyMm)),
  )
  return months.flat()
}

import { isBefore, isValid, parseISO, subDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { z } from 'zod'

// Lookups over ledger/<yyyy-mm>.jsonl history (Implementation Notes 2.2,
// 10.4 and § 7). The publisher writes "merged", "rejected" and
// "prClosedStale" lines beside the reader's own
// (packages/gp-ai/case_scout/publisher.py).

export const DUPLICATE_WINDOW_DAYS = 30
export const REJECTION_SUPPRESSION_WINDOW_DAYS = 30
export const RECENT_PROPOSALS_WINDOW_DAYS = 30

export type LedgerEntry = {
  runId: string | undefined
  conversationId: string
  agentId: string
  outcome: string
  caseId: string | undefined
  failureSummary: string
  createdAt: Date | undefined
  closedAt: Date | undefined
}

const timestamp = (value: string | undefined): Date | undefined => {
  if (!value) return undefined
  const parsed = parseISO(value)
  return isValid(parsed) ? parsed : undefined
}

const optionalString = z.string().optional().catch(undefined)

// Every field optional and tolerant: a malformed historical line, or one the
// publisher wrote without an agent, is skipped rather than failing tonight.
const RawLedgerLineSchema = z.object({
  runId: optionalString,
  conversationId: optionalString,
  agentId: optionalString,
  outcome: optionalString,
  caseId: optionalString,
  failureSummary: optionalString,
  createdAt: optionalString,
  closedAt: optionalString,
})

export const parseLedgerText = (text: string): LedgerEntry[] =>
  text.split('\n').flatMap((line): LedgerEntry[] => {
    if (line.trim() === '') return []
    let raw: z.infer<typeof RawLedgerLineSchema>
    try {
      raw = RawLedgerLineSchema.parse(JSON.parse(line))
    } catch {
      return []
    }
    const { conversationId, agentId, outcome } = raw
    if (!conversationId || !agentId || !outcome) return []
    return [
      {
        runId: raw.runId,
        conversationId,
        agentId,
        outcome,
        caseId: raw.caseId,
        failureSummary: raw.failureSummary ?? '',
        createdAt: timestamp(raw.createdAt),
        closedAt: timestamp(raw.closedAt),
      },
    ]
  })

const normalizeSummary = (summary: string): string =>
  summary.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ')

// The key that stops a repeat proposal: conversation, agent and the drafting
// call's one-line failure summary.
const sameKey = (
  entry: LedgerEntry,
  conversationId: string,
  agentId: string,
  failureSummary: string,
): boolean =>
  entry.conversationId === conversationId &&
  entry.agentId === agentId &&
  normalizeSummary(entry.failureSummary) === normalizeSummary(failureSummary)

const newestFirst =
  (pick: (entry: LedgerEntry) => Date | undefined) =>
  (a: LedgerEntry, b: LedgerEntry): number => {
    const left = pick(a)
    const right = pick(b)
    if (!left || !right) return 0
    return isBefore(left, right) ? 1 : isBefore(right, left) ? -1 : 0
  }

const onOrAfter = (date: Date | undefined, cutoff: Date): date is Date =>
  date !== undefined && !isBefore(date, cutoff)

export const findDuplicate = (
  entries: LedgerEntry[],
  conversationId: string,
  agentId: string,
  failureSummary: string,
  now: Date,
): LedgerEntry | undefined => {
  const cutoff = subDays(now, DUPLICATE_WINDOW_DAYS)
  return entries
    .filter(
      (entry) =>
        entry.outcome === 'proposed' &&
        sameKey(entry, conversationId, agentId, failureSummary) &&
        onOrAfter(entry.createdAt, cutoff),
    )
    .sort(newestFirst((entry) => entry.createdAt))[0]
}

export const findRejection = (
  entries: LedgerEntry[],
  conversationId: string,
  agentId: string,
  failureSummary: string,
  now: Date,
): LedgerEntry | undefined => {
  const cutoff = subDays(now, REJECTION_SUPPRESSION_WINDOW_DAYS)
  return entries
    .filter(
      (entry) =>
        entry.outcome === 'rejected' &&
        sameKey(entry, conversationId, agentId, failureSummary) &&
        onOrAfter(entry.closedAt, cutoff),
    )
    .sort(newestFirst((entry) => entry.closedAt))[0]
}

export const recentProposalsForAgent = (
  entries: LedgerEntry[],
  agentId: string,
  now: Date,
): LedgerEntry[] => {
  const cutoff = subDays(now, RECENT_PROPOSALS_WINDOW_DAYS)
  return entries
    .filter(
      (entry) =>
        entry.outcome === 'proposed' &&
        entry.agentId === agentId &&
        onOrAfter(entry.createdAt, cutoff),
    )
    .sort(newestFirst((entry) => entry.createdAt))
}

// The month keys a window of up to 30 days can touch, oldest first.
export const monthKeysCovering = (end: Date, days: number): string[] => [
  ...new Set(
    [subDays(end, days), end].map((stamp) =>
      formatInTimeZone(stamp, 'UTC', 'yyyy-MM'),
    ),
  ),
]

import { z } from 'zod'

// One object per picker failure (the call erroring/timing out after its
// retry, or answering something that is not valid JSON in the picker's
// shape), written under this prefix in the judge records bucket. Kept
// separate from `guard/<yyyy-mm>.jsonl` (Implementation Notes 2.6's per-sweep
// ledger line), because that line is written once the final agent set is
// known and a picker failure is a thing that happens before that — and
// because listing this prefix is how the 7-day alert counts without needing
// to parse every ledger line ever written.
export const PICKER_FAILURE_PREFIX = 'guard/picker-failures/'

export const pickerFailureKey = (pr: number, runId: string): string =>
  `${PICKER_FAILURE_PREFIX}${pr}-${runId}.json`

export const PickerFailureSchema = z.object({
  pr: z.number(),
  runId: z.string().min(1),
  // ISO 8601. Read back for the 7-day window, so this is the one field the
  // alert logic actually depends on — everything else is for a human reading
  // the object directly.
  timestamp: z.iso.datetime(),
  reason: z.enum(['timeout_or_error', 'invalid_shape']),
  detail: z.string(),
})
export type PickerFailure = z.infer<typeof PickerFailureSchema>

export interface FailureLogPort {
  putObject: (key: string, body: string) => Promise<void>
  listKeys: (prefix: string) => Promise<string[]>
  getObject: (key: string) => Promise<string>
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

// "Alert when the picker fails twice in a week. Once is noise." (TDD "When
// the picker fails"). Counts this failure plus every other one on record
// whose timestamp falls inside the trailing 7-day window ending now — not a
// calendar week — so two failures 8 days apart (test plan) never share a
// window.
export const shouldAlert = (
  failures: readonly PickerFailure[],
  now: Date,
): boolean => {
  const windowStart = now.getTime() - SEVEN_DAYS_MS
  const withinWindow = failures.filter(
    (f) => new Date(f.timestamp).getTime() >= windowStart,
  )
  return withinWindow.length >= 2
}

// Records this failure and reports whether it is the 2nd-or-later one in the
// trailing 7 days, so the caller can decide whether to alert. Tolerant of a
// stray unparsable object in the prefix (a read a human made by hand, or a
// future field this version does not know): it is skipped rather than
// failing the whole guard run, which must never block on bookkeeping.
export const recordPickerFailure = async (
  port: FailureLogPort,
  failure: PickerFailure,
): Promise<{ shouldAlert: boolean; windowCount: number }> => {
  await port.putObject(
    pickerFailureKey(failure.pr, failure.runId),
    JSON.stringify(failure, null, 2),
  )

  const keys = await port.listKeys(PICKER_FAILURE_PREFIX)
  const failures: PickerFailure[] = []
  for (const key of keys) {
    try {
      const text = await port.getObject(key)
      const parsed = PickerFailureSchema.safeParse(JSON.parse(text) as unknown)
      if (parsed.success) failures.push(parsed.data)
    } catch {
      continue
    }
  }

  const now = new Date(failure.timestamp)
  const windowStart = now.getTime() - SEVEN_DAYS_MS
  const windowCount = failures.filter(
    (f) => new Date(f.timestamp).getTime() >= windowStart,
  ).length

  return { shouldAlert: shouldAlert(failures, now), windowCount }
}

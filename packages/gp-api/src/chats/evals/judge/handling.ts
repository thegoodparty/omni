import type { Judgment, HandledValue, JudgmentOrder } from './judge'
import type { Arm } from './record'

// Per case: did each arm reach the outcome the case's `handledWhen` sentence
// describes? The comparison cannot see a failure both arms share: two runs
// that miss the same planted problem read as a tie, and on the first bench
// one read as a clear win for the base. This reads the judge's per-run
// `handled` answers instead, oriented to arms.
//
// ADDITIVE. Nothing here moves the verdict label or any score; it is its own
// section of the report.

export type HandlingClass =
  | 'bothHandled'
  | 'sharedFailure'
  | 'regression'
  | 'improvement'

export interface ArmHandling {
  primary?: HandledValue
  swapped?: HandledValue
}

export interface CaseHandling {
  caseId: string
  attempt: number
  base: ArmHandling
  candidate: ArmHandling
  class: HandlingClass
}

const valuesOf = (arm: ArmHandling): HandledValue[] =>
  [arm.primary, arm.swapped].filter((v): v is HandledValue => v !== undefined)

// Handled only when every order said yes. `partly` is not handled, and two
// orders that disagree are not handled either: a value that moves with the
// slot is not a reading of the run.
export const armHandled = (arm: ArmHandling): boolean => {
  const values = valuesOf(arm)
  return values.length > 0 && values.every((v) => v === 'yes')
}

export const ordersDisagree = (arm: ArmHandling): boolean => {
  const values = valuesOf(arm)
  return values.length === 2 && values[0] !== values[1]
}

export const classify = (
  base: ArmHandling,
  candidate: ArmHandling,
): HandlingClass => {
  const b = armHandled(base)
  const c = armHandled(candidate)
  if (b && c) return 'bothHandled'
  if (!b && !c) return 'sharedFailure'
  return b ? 'regression' : 'improvement'
}

export const conditionHandling = (
  judgments: readonly Judgment[],
): CaseHandling[] => {
  const byPair = new Map<
    string,
    { caseId: string; attempt: number; arms: Record<Arm, ArmHandling> }
  >()
  for (const j of judgments) {
    if (j.kind !== 'graded' || j.handled === undefined) continue
    const key = `${j.key.caseId}\u0000${j.key.attempt}`
    const entry = byPair.get(key) ?? {
      caseId: j.key.caseId,
      attempt: j.key.attempt,
      arms: { base: {}, candidate: {} },
    }
    const order: JudgmentOrder = j.key.order
    // Through THIS judgment's own slot map: a swapped judgment put the other
    // arm in X.
    entry.arms[j.slotMap.X][order] = j.handled.X
    entry.arms[j.slotMap.Y][order] = j.handled.Y
    byPair.set(key, entry)
  }
  return [...byPair.values()]
    .map(({ caseId, attempt, arms }) => ({
      caseId,
      attempt,
      base: arms.base,
      candidate: arms.candidate,
      class: classify(arms.base, arms.candidate),
    }))
    .sort((a, b) =>
      a.caseId === b.caseId
        ? a.attempt - b.attempt
        : a.caseId.localeCompare(b.caseId),
    )
}

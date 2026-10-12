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
  // How many orders this pair was judged in, graded or not. More than an
  // arm has values for means an order came back ungraded.
  ordersJudged: number
}

export interface ConditionHandling {
  cases: CaseHandling[]
  // Pairs whose case carries a handling sentence but whose every judgment
  // came back ungraded, so nothing was read. Counted, never silent.
  notGraded: number
}

export const handlingPairKey = (caseId: string, attempt: number): string =>
  `${caseId}\u0000${attempt}`

export const oneOrderOnly = (h: CaseHandling, arm: ArmHandling): boolean =>
  [arm.primary, arm.swapped].filter((v) => v !== undefined).length <
  h.ordersJudged

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

// `asked` is every pair whose case carries a handling sentence, keyed the
// way `handlingPairKey` keys them, so a pair the judge never graded is still known.
export const conditionHandling = (
  judgments: readonly Judgment[],
  asked: ReadonlySet<string>,
): ConditionHandling => {
  const ordersJudged = new Map<string, number>()
  for (const j of judgments) {
    const key = handlingPairKey(j.key.caseId, j.key.attempt)
    if (asked.has(key)) ordersJudged.set(key, (ordersJudged.get(key) ?? 0) + 1)
  }
  const byPair = new Map<
    string,
    { caseId: string; attempt: number; arms: Record<Arm, ArmHandling> }
  >()
  for (const j of judgments) {
    if (j.kind !== 'graded' || j.handled === undefined) continue
    const key = handlingPairKey(j.key.caseId, j.key.attempt)
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
  const cases = [...byPair.entries()]
    .map(([key, { caseId, attempt, arms }]) => ({
      caseId,
      attempt,
      base: arms.base,
      candidate: arms.candidate,
      class: classify(arms.base, arms.candidate),
      ordersJudged: ordersJudged.get(key) ?? 1,
    }))
    .sort((a, b) =>
      a.caseId === b.caseId
        ? a.attempt - b.attempt
        : a.caseId.localeCompare(b.caseId),
    )
  return {
    cases,
    notGraded: [...ordersJudged.keys()].filter((key) => !byPair.has(key))
      .length,
  }
}

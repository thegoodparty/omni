// The verdict, read case by case rather than pooled. A suite compares two
// builds of one agent, so the evidence for a change is a case whose behavior
// moved the same way more than once. Nothing here is a significance test: two
// attempts of one case agreeing on one criterion is the bar, and the bar is
// about repetition of an observed behavior, not about a p-value.

export type ChangeDirection = 'better' | 'worse'

// One attempt's reading of one criterion, already oriented to the arms: the
// direction is about the candidate, and it is only present when both grading
// orders read the same change.
export type PairChange = {
  criterion: string
  direction: ChangeDirection
  // One line per grading order, naming what each saw.
  evidence: readonly string[]
}

// The part of a pair the verdict reads. Kept structural so this module never
// depends on `grade.ts`: a test builds them directly.
export type PairReading = {
  attempt: number
  changes: readonly PairChange[]
  // Criteria the two orders read in opposite directions, or one order read a
  // change and the other read none. Not a change, and not a tie either.
  disagreements: readonly string[]
}

// A change two or more attempts of one case agreed on.
export type ConfirmedChange = {
  caseId: string
  criterion: string
  direction: ChangeDirection
  // One entry per attempt that read it, with both orders' evidence for it.
  attempts: { attempt: number; evidence: string[] }[]
}

// The fewest attempts of one case that confirm a change. Two of three: a single
// attempt cannot tell a repeated behavior from one reading that happened to
// move, and requiring all three would let one flaky attempt bury a defect.
export const CONFIRMING_ATTEMPTS = 2

export type CaseVerdictLabel = 'BETTER' | 'WORSE' | 'NO DIFFERENCE FOUND'

export type CaseTally = {
  caseId: string
  verdict: CaseVerdictLabel
  // Pairs that reached the grader, and attempts of this case that did not.
  judged: number
  notJudged: number
  confirmed: ConfirmedChange[]
  // Both orders read no material change on any criterion.
  ties: number
  // Attempts where the two orders disagreed, by criterion.
  disagreements: { attempt: number; criteria: string[] }[]
}

const changeKey = (criterion: string, direction: ChangeDirection) =>
  `${direction}\u0000${criterion}`

const tallyOf = (
  caseId: string,
  readings: readonly PairReading[],
): Map<string, ConfirmedChange> => {
  const byKey = new Map<string, ConfirmedChange>()
  for (const reading of readings)
    for (const { criterion, direction, evidence } of reading.changes) {
      const key = changeKey(criterion, direction)
      const confirmed = byKey.get(key) ?? {
        caseId,
        criterion,
        direction,
        attempts: [],
      }
      if (confirmed.attempts.some(({ attempt }) => attempt === reading.attempt))
        continue
      confirmed.attempts.push({
        attempt: reading.attempt,
        evidence: [...evidence],
      })
      byKey.set(key, confirmed)
    }
  return byKey
}

// A case's verdict, from the changes its own attempts agreed on. A confirmed
// regression wins outright: an improvement in the same case, or in any other,
// does not cancel it.
export const readCaseVerdict = ({
  caseId,
  readings,
  notJudged = 0,
}: {
  caseId: string
  readings: readonly PairReading[]
  notJudged?: number
}): CaseTally => {
  const tally = tallyOf(caseId, readings)
  const confirmed = [...tally.values()]
    .filter(({ attempts }) => attempts.length >= CONFIRMING_ATTEMPTS)
    .sort((left, right) => left.criterion.localeCompare(right.criterion))
  const verdict: CaseVerdictLabel = confirmed.some(
    ({ direction }) => direction === 'worse',
  )
    ? 'WORSE'
    : confirmed.some(({ direction }) => direction === 'better')
      ? 'BETTER'
      : 'NO DIFFERENCE FOUND'
  return {
    caseId,
    verdict,
    judged: readings.length,
    notJudged,
    confirmed,
    ties: readings.filter(
      (reading) =>
        reading.changes.length === 0 && reading.disagreements.length === 0,
    ).length,
    disagreements: readings
      .filter((reading) => reading.disagreements.length > 0)
      .map((reading) => ({
        attempt: reading.attempt,
        criteria: [...reading.disagreements],
      })),
  }
}

export type SuiteVerdictLabel =
  | 'BETTER'
  | 'WORSE'
  | 'NO DIFFERENCE FOUND'
  | "CAN'T JUDGE"

export type SuiteVerdict = {
  label: SuiteVerdictLabel
  // Every confirmed change the run found, regressions first: this is the
  // evidence a reader acts on, and it names the case and criterion.
  confirmed: ConfirmedChange[]
  cases: CaseTally[]
  judged: number
  // Pairs a failed run kept from the grader. Never a vote, and enough of them
  // can decide that nothing was measured.
  notJudged: number
}

// A suite whose pairs mostly never reached the grader has measured nothing: its
// readings are the minority of its attempts, and calling it BETTER or NO
// DIFFERENCE FOUND claims more than the run saw. Zero judged pairs cannot even
// reach NO DIFFERENCE FOUND, which would say the arms looked alike.
export const cannotJudge = (judged: number, notJudged: number): boolean =>
  judged === 0 || notJudged > judged

const bySeverity = (left: ConfirmedChange, right: ConfirmedChange) =>
  left.direction === right.direction
    ? `${left.caseId} ${left.criterion}`.localeCompare(
        `${right.caseId} ${right.criterion}`,
      )
    : left.direction === 'worse'
      ? -1
      : 1

// WORSE if any case confirmed a regression, whatever else the run found and
// however much of it did not run.
//
// Otherwise inadequate coverage is a CAN'T JUDGE, not a quiet pass: a suite that
// mostly did not run cannot say the candidate is better or that it is the same.
// That is an execution status about the run, never a statement about quality.
//
// Otherwise BETTER if some case confirmed an improvement — no confirmed
// regression exists by this point — and NO DIFFERENCE FOUND when nothing was
// confirmed. Neither direction pools votes across cases.
export const readVerdict = ({
  cases,
  notJudged,
}: {
  cases: readonly CaseTally[]
  notJudged: number
}): SuiteVerdict => {
  const judged = cases.reduce((total, tally) => total + tally.judged, 0)
  const confirmed = cases.flatMap((tally) => tally.confirmed).sort(bySeverity)
  const label: SuiteVerdictLabel = confirmed.some(
    ({ direction }) => direction === 'worse',
  )
    ? 'WORSE'
    : cases.some((tally) => tally.judged === 0) || cannotJudge(judged, notJudged)
      ? "CAN'T JUDGE"
      : confirmed.some(({ direction }) => direction === 'better')
        ? 'BETTER'
        : 'NO DIFFERENCE FOUND'
  return { label, confirmed, cases: [...cases], judged, notJudged }
}

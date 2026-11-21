export const GuardOutcomes = [
  'no_suite_reached',
  'BETTER',
  'NO DIFFERENCE FOUND',
  'WORSE',
  "CAN'T JUDGE",
  'judge crashed',
] as const
export type GuardOutcome = (typeof GuardOutcomes)[number]

// The check is shadow-only: every swept result is neutral and the verdict is
// in the title, so it never goes red. Only a PR that reaches no suite passes.
export type CheckConclusion = 'success' | 'neutral'

export interface GuardCheckResult {
  readonly conclusion: CheckConclusion
  readonly note: string
}

export const mapGuardOutcome = (outcome: GuardOutcome): GuardCheckResult => {
  switch (outcome) {
    case 'no_suite_reached':
      return { conclusion: 'success', note: 'No suite reached.' }
    case 'BETTER':
      return { conclusion: 'neutral', note: 'BETTER.' }
    case 'NO DIFFERENCE FOUND':
      return { conclusion: 'neutral', note: 'NO DIFFERENCE FOUND.' }
    case 'WORSE':
      return {
        conclusion: 'neutral',
        note: 'WORSE. Read the job summary before merging.',
      }
    case "CAN'T JUDGE":
      return {
        conclusion: 'neutral',
        note: "CAN'T JUDGE (not enough judged pairs).",
      }
    case 'judge crashed':
      return {
        conclusion: 'neutral',
        note: 'The judge crashed or reported no verdict.',
      }
  }
}

// Several suites can run at once and the check is one check for the PR, so
// their outcomes collapse to the worst one.
const SEVERITY: readonly GuardOutcome[] = [
  'judge crashed',
  'WORSE',
  "CAN'T JUDGE",
  'NO DIFFERENCE FOUND',
  'BETTER',
  'no_suite_reached',
]

export const worstOutcome = (
  outcomes: readonly GuardOutcome[],
): GuardOutcome => {
  if (outcomes.length === 0) return 'no_suite_reached'
  for (const candidate of SEVERITY) {
    if (outcomes.includes(candidate)) return candidate
  }
  throw new Error('worstOutcome: no outcome matched the severity table')
}

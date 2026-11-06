// ENG-11592: the guard's check-result mapping table (TDD "Shadow only"):
//
//   | Result                          | Check result                |
//   | -------------------------------- | --------------------------- |
//   | No agent reached, BETTER, SAME   | pass                        |
//   | WORSE                            | neutral, flagged for ruling |
//   | CAN'T SAY                        | pass, with a note           |
//   | Infra error or refusal           | neutral, with an alert      |
//
// Pure and GitHub-API-shaped on purpose: `success` and `neutral` are the two
// conclusions this story is ever allowed to post (never `failure` — this
// check is shadow-only and must never fail the PR, TDD "Shadow only").

export const GuardOutcomes = [
  'no_agent_reached',
  'BETTER',
  'SAME',
  'WORSE',
  "CAN'T SAY",
  'infra_error',
] as const
export type GuardOutcome = (typeof GuardOutcomes)[number]

export type CheckConclusion = 'success' | 'neutral'

export interface GuardCheckResult {
  readonly conclusion: CheckConclusion
  readonly note: string
}

// One agent's report-section label, as `report.ts` prints it
// (`### ${score.agentId} — ${score.label}`, or `— refused`). `'refused'`
// folds into the same `infra_error` bucket as a sweep-level infra failure —
// the TDD's own table pairs them in one row ("Infra error or refusal").
export const AGENT_LABEL_TO_OUTCOME: Readonly<Record<string, GuardOutcome>> = {
  BETTER: 'BETTER',
  SAME: 'SAME',
  WORSE: 'WORSE',
  "CAN'T SAY": "CAN'T SAY",
  refused: 'infra_error',
}

export const mapGuardOutcome = (outcome: GuardOutcome): GuardCheckResult => {
  switch (outcome) {
    case 'no_agent_reached':
      return { conclusion: 'success', note: 'No agent reached.' }
    case 'BETTER':
      return { conclusion: 'success', note: 'BETTER.' }
    case 'SAME':
      return { conclusion: 'success', note: 'SAME.' }
    case 'WORSE':
      return {
        conclusion: 'neutral',
        note: 'WORSE. Flagged for a ruling: `/judge agree` or `/judge dispute <reason>`.',
      }
    case "CAN'T SAY":
      return {
        conclusion: 'success',
        note:
          "CAN'T SAY (not enough evidence). This is the common result for a " +
          'background agent, which reads at most 3 cases a sweep.',
      }
    case 'infra_error':
      // No Slack post happens on this path — only the picker-failure alert
      // in judge-guard.yml sends one, and that is a different failure mode
      // (the picker, not the sweep). Don't claim one here (ENG-11592
      // correction).
      return {
        conclusion: 'neutral',
        note: 'The sweep hit an infra error or a refusal.',
      }
  }
}

// Several agents can run in one guard sweep (the floor plus the picker's
// additions), and the check is one check for the whole PR, so their outcomes
// collapse to the worst one. Precedence follows the table's own severity
// order: an infra error or refusal is worse than a WORSE verdict (it means
// the guard could not even tell), WORSE is worse than CAN'T SAY, and
// CAN'T SAY is worse than a clean BETTER/SAME. An empty list is
// `no_agent_reached`, the best outcome, since nothing ran.
const SEVERITY: readonly GuardOutcome[] = [
  'infra_error',
  'WORSE',
  "CAN'T SAY",
  'SAME',
  'BETTER',
  'no_agent_reached',
]

export const worstOutcome = (
  outcomes: readonly GuardOutcome[],
): GuardOutcome => {
  if (outcomes.length === 0) return 'no_agent_reached'
  for (const candidate of SEVERITY) {
    if (outcomes.includes(candidate)) return candidate
  }
  // Unreachable: SEVERITY lists every GuardOutcome, and `outcomes` is
  // non-empty here, so some element of it always matches one of them.
  throw new Error('worstOutcome: no outcome matched the severity table')
}

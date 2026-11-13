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

import { findAgent } from '../agents'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from '../config'
import type { AgentShape } from '../record'

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
      return { conclusion: 'success', note: "CAN'T SAY (not enough evidence)." }
    case 'infra_error':
      // No Slack post happens on this path. Don't claim one here (ENG-11592
      // correction).
      return {
        conclusion: 'neutral',
        note: 'The sweep hit an infra error or a refusal.',
      }
  }
}

// The background budget is the one structural reason a sweep comes back
// CAN'T SAY: its case cap times its attempts falls under the judge's
// minimum pair count, so its verdict is gated whatever the change did. A
// chat agent has no such reason, so the note gives none for it.
export const cantSayNote = (
  agentIds: readonly string[],
  shapeOf: (agentId: string) => AgentShape | undefined = (agentId) =>
    findAgent(agentId)?.shape,
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
): string => {
  const base = mapGuardOutcome("CAN'T SAY").note
  const { maxCases, attemptsPerCase } = config.background
  const gated =
    maxCases !== undefined && maxCases * attemptsPerCase < config.gates.minCases
  const background = agentIds.filter((id) => shapeOf(id) === 'background')
  if (!gated || background.length === 0) return base
  return (
    `${base} This is the common result for a background agent ` +
    `(${background.map((id) => `\`${id}\``).join(', ')}), which reads at ` +
    `most ${maxCases} cases a sweep.`
  )
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

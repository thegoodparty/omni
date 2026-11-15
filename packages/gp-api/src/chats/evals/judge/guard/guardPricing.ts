// ENG-11592: price the guard's floor and final agent sets before the sweep
// runs, reusing the existing plan estimate rather than re-deriving a cost
// (ticket "Implementation Details"; Implementation Notes 6: "price the final
// agent set with the existing plan estimate (planCost.ts) before the
// sweep").
//
// Unlike judge.yml's own estimate step, this never prices against the base
// ref or the default branch's copy of planCost.ts. That cross-ref guard
// exists there because the PLAN job checks out the PR's own candidate code,
// so a PR could edit its own planCost.ts to lower its own estimate.
// judge-guard.yml never checks out the PR (its own header: "this workflow
// never checks out or runs the PR's own code") — pricing here always reads
// main's own planCost.ts, over the floor/final AGENT IDS the picker already
// resolved, so there is no self-serving table for a PR to edit.
import { requireAgent } from '../agents'
import { DEFAULT_JUDGE_CONFIG } from '../config'
import { estimateAgent, type AgentEstimate } from '../planCost'

export interface AgentSetEstimate {
  readonly cents: number
  readonly perAgent: Readonly<Record<string, AgentEstimate>>
}

export const priceAgentSet = (
  agentIds: readonly string[],
): AgentSetEstimate => {
  const perAgent: Record<string, AgentEstimate> = {}
  let cents = 0
  for (const agentId of agentIds) {
    const estimate = estimateAgent(requireAgent(agentId), DEFAULT_JUDGE_CONFIG)
    perAgent[agentId] = estimate
    cents += estimate.cents
  }
  return { cents, perAgent }
}

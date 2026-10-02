import { describe, expect, it } from 'vitest'
import { AGENTS, findAgent } from './agents'
import { loadCaseList } from './cases'
import { DEFAULT_JUDGE_CONFIG } from './config'
import { agentConfigFor } from './runners/agentConfig'
import { armWallClockMs } from './runners/backgroundDispatch'

// THE REASON NO BACKGROUND SWEEP RUNS YET, measured against the real registry
// and the real published manifests rather than asserted in a comment.
//
// The runner is wired. What is missing is a budget: `walkCases` is a
// sequential `for … await`, so one agent's arm is cases x attempts runs end
// to end, each waiting out that agent's own declared timeout. At the
// registry's case lists and attemptsPerCase 3 that is 24 runs, and the
// cheapest published agent still comes to six hours against a job allowed
// three — so every one of them is refused by name in `caseLoaderFor`.
//
// This file exists so that fact is a red-or-green number in CI instead of
// something found in a sweep's logs after an arm has been billed. When
// background gets its own case and attempt budget, these expectations are
// what say whether it was enough.

// What the sweep job allows one arm, mirroring sweep.eval.test.ts.
const ARM_BUDGET_MS = 70 * 60 * 1000

const sweepable = AGENTS.filter(
  (agent) => agent.shape === 'background' && agent.status !== 'blocked',
).map((agent) => agent.agentId)

const wallClockFor = (agentId: string): number => {
  const agent = findAgent(agentId)
  if (agent === undefined) throw new Error(`${agentId} is not in the registry`)
  return armWallClockMs(
    loadCaseList(agent).cases.length,
    DEFAULT_JUDGE_CONFIG.attemptsPerCase,
    agentConfigFor(agentId),
  )
}

describe('one arm of one background agent, against the job budget', () => {
  // NOT `toBeLessThan`. Writing the aspiration would make this file red for
  // every one of the fifteen and say nothing about which. Pinning the current
  // answer means the day a budget change lands, exactly the agents it fixed
  // turn red and have to be moved — which is the review the change deserves.
  it.each(sweepable)('%s does not fit, and is refused by name', (agentId) => {
    expect(wallClockFor(agentId)).toBeGreaterThan(ARM_BUDGET_MS)
  })

  // The cheapest one, so the size of the gap is a number someone can act on
  // rather than "too long". Six hours against seventy minutes.
  it('leaves the smallest agent more than five times over', () => {
    const smallest = Math.min(...sweepable.map(wallClockFor))
    expect(Math.round(smallest / 60_000)).toBe(360)
    expect(smallest / ARM_BUDGET_MS).toBeGreaterThan(5)
  })
})

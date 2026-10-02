import { describe, expect, it } from 'vitest'
import { AGENTS, findAgent } from './agents'
import { loadCaseList } from './cases'
import { DEFAULT_JUDGE_CONFIG } from './config'
import { agentConfigFor } from './runners/agentConfig'
import { armWallClockMs } from './runners/backgroundDispatch'
import { attemptsFor } from './sweepArm'

// WHAT THE BACKGROUND BUDGET BUYS AND WHAT IT COSTS, both as numbers.
//
// The budget was chosen deliberately: 1 attempt over 3 cases, because the
// chat budget (3 attempts over 8 cases) is twenty-six hours of wall clock and
// roughly $300 to judge one background agent. This file pins both halves of
// that trade so neither can drift unnoticed — the half that makes background
// runnable, and the half that makes its verdicts weak.

const ARM_BUDGET_MS = 70 * 60 * 1000
const { background } = DEFAULT_JUDGE_CONFIG

const sweepable = AGENTS.filter(
  (agent) => agent.shape === 'background' && agent.status !== 'blocked',
).map((agent) => agent.agentId)

const casesFor = (agentId: string): number => {
  const agent = findAgent(agentId)
  if (agent === undefined) throw new Error(`${agentId} is not in the registry`)
  const all = loadCaseList(agent).cases.length
  return background.maxCases === undefined
    ? all
    : Math.min(all, background.maxCases)
}

describe('the background budget makes a sweep possible', () => {
  it('is the budget that was chosen, not the chat one', () => {
    expect(background).toEqual({ attemptsPerCase: 1, maxCases: 3 })
    expect(DEFAULT_JUDGE_CONFIG.attemptsPerCase).toBe(3)
  })

  it.each(sweepable)('%s takes its own attempt count', (agentId) => {
    const agent = findAgent(agentId)
    expect(agent).toBeDefined()
    if (agent === undefined) return
    expect(attemptsFor(agent, DEFAULT_JUDGE_CONFIG)).toBe(1)
  })

  // ONE case of the slowest agent is 65 minutes, so three of them run
  // sequentially do not fit and ten of the fifteen agents still overrun.
  // Named here rather than discovered: the cap alone is not enough, the cases
  // have to run concurrently. Until they do, the refusal in caseLoaderFor is
  // what keeps a doomed arm from starting.
  it('still does not fit every agent while cases run one at a time', () => {
    const overrunning = sweepable.filter(
      (agentId) =>
        armWallClockMs(
          casesFor(agentId),
          background.attemptsPerCase,
          agentConfigFor(agentId),
        ) > ARM_BUDGET_MS,
    )
    expect(overrunning.length).toBeGreaterThan(0)
    expect(overrunning).toContain('meeting_briefing')
  })
})

describe('and what the background budget costs', () => {
  // THE GATE WILL FLAG EVERY BACKGROUND VERDICT, and that is the gate
  // working. 3 cases x 1 attempt is 3 pairs against a floor of 20, so the
  // comparison is directional rather than conclusive.
  //
  // The floor is deliberately NOT lowered to match. A gate moved to fit the
  // evidence stops being a gate, and the note it emits says exactly why the
  // verdict is weak — which is more useful than a clean-looking verdict
  // resting on three runs.
  it('leaves a background comparison under the evidence floor', () => {
    const pairs = 3 * background.attemptsPerCase
    expect(pairs).toBeLessThan(DEFAULT_JUDGE_CONFIG.gates.minCases)
  })

  it('leaves the floor where it is', () => {
    expect(DEFAULT_JUDGE_CONFIG.gates.minCases).toBe(20)
  })
})

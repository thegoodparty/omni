import { describe, expect, it } from 'vitest'
import { AGENTS, findAgent, type AgentEntry } from './agents'
import { loadBackgroundCases } from './cases'
import { DEFAULT_JUDGE_CONFIG } from './config'
import { SWEEP_VALUES } from './fixtures/sweep'
import { ARM_BUDGET_MS, armCaseLoader } from './runners/backgroundDispatch'
import { attemptsFor } from './sweepArm'

// WHAT THE BACKGROUND BUDGET BUYS AND WHAT IT COSTS, measured against the real
// registry and the real published manifests THROUGH THE REAL LOADER.
//
// Through the loader rather than by recomputing cases x attempts x poll here.
// The file this replaces did its own arithmetic, so when the budget changed it
// kept measuring a combination nothing used — the full list at the chat
// attempt count — and stayed green while claiming all fifteen agents were
// refused when four were not.
//
// When the budget, a case list or an agent's timeout changes, these lists go
// red naming exactly the agents that moved. That is the review such a change
// deserves; re-pin them deliberately.

const { background } = DEFAULT_JUDGE_CONFIG

const sweepable = AGENTS.filter(
  (agent) => agent.shape === 'background' && agent.status !== 'blocked',
)

const agent = (agentId: string): AgentEntry => {
  const found = findAgent(agentId)
  if (found === undefined) throw new Error(`${agentId} is not in the registry`)
  return found
}

// The production refusal, asked one agent at a time with a fresh budget.
const fitsAlone = (entry: AgentEntry): boolean => {
  try {
    armCaseLoader(SWEEP_VALUES, ARM_BUDGET_MS, DEFAULT_JUDGE_CONFIG)(entry)
    return true
  } catch (err) {
    if (
      err instanceof Error &&
      /would take|runs in flight at once/.test(err.message)
    ) {
      return false
    }
    throw err
  }
}

const walked = (entry: AgentEntry): string[] =>
  armCaseLoader(
    SWEEP_VALUES,
    Number.MAX_SAFE_INTEGER,
    DEFAULT_JUDGE_CONFIG,
  )(entry).cases.map((one) => one.caseId)

describe('the background budget', () => {
  // A literal on purpose: this is the one place the chosen numbers are
  // written down as a decision rather than read back from the config.
  it('is 1 attempt over the first 3 cases, 12 runs at once', () => {
    expect(background).toEqual({
      attemptsPerCase: 1,
      maxCases: 3,
      maxInFlight: 12,
    })
  })

  // Both halves. Every background agent returning 1 says nothing about chat,
  // and returning the background number for every shape passed the file
  // this replaces.
  it('gives background 1 attempt and leaves chat at 3', () => {
    expect(attemptsFor(agent('meeting_briefing'), DEFAULT_JUDGE_CONFIG)).toBe(1)
    expect(attemptsFor(agent('chief_of_staff'), DEFAULT_JUDGE_CONFIG)).toBe(3)
  })

  // The loader the arm actually calls, on every real list: the first three
  // cases of each file, in file order, which is what makes the two arms'
  // selections pair.
  it.each(sweepable.map((one) => one.agentId))(
    '%s walks the first three cases of its list',
    (agentId) => {
      const entry = agent(agentId)
      const file = loadBackgroundCases(entry).map((one) => one.caseId)
      expect(walked(entry)).toEqual(file.slice(0, 3))
    },
  )
})

describe('what it makes possible, with every run started at once', () => {
  // Every agent fits an arm on its own now. A run waits out at most its
  // agent's declared timeout plus the poll headroom, the longest is
  // meeting_briefing at 65 minutes, and an arm's runs finish together rather
  // than one after another. Run in sequence, eleven of these did not fit.
  it('admits every agent on its own', () => {
    expect(sweepable.filter((one) => !fitsAlone(one))).toEqual([])
    expect(sweepable.length).toBe(15)
  })

  // TOGETHER IS NOT THE SUM OF ALONE. One arm fills twelve slots in registry
  // order, three runs an agent, so four agents share an arm and the rest are
  // refused by name. Judging all fifteen takes four sweeps.
  it('runs the first four when every agent shares an arm', () => {
    const shared = armCaseLoader(
      SWEEP_VALUES,
      ARM_BUDGET_MS,
      DEFAULT_JUDGE_CONFIG,
    )
    const admitted = sweepable.filter((one) => {
      try {
        shared(one)
        return true
      } catch {
        return false
      }
    })
    expect(admitted.map((one) => one.agentId)).toEqual([
      'campaign_tracker_tasks',
      'district_issue_pulse',
      'district_issue_snapshot',
      'find_existing_ordinances',
    ])
  })
})

describe('and what it costs', () => {
  // How many pairs a background comparison yields, from what the real loader
  // walks and the real attempt count. That this is under the evidence floor —
  // so every background verdict reads directional, not conclusive — is
  // checked against the real gate in score.test.ts, not restated here.
  //
  // The floor is deliberately not lowered to match. A gate moved to fit the
  // evidence stops being a gate, and the note it emits says exactly why the
  // verdict is weak.
  it('yields three pairs per background agent', () => {
    const entry = agent('opposition_research')
    expect(
      walked(entry).length * attemptsFor(entry, DEFAULT_JUDGE_CONFIG),
    ).toBe(3)
  })

  // THE CAP DROPS THE HARDEST CASES, not a random third of them. Case lists
  // open with a baseline and save their probes for later, so first-three
  // keeps the easy cases and loses injection, staleness, zero-evidence and
  // the control. First-n is still right — two arms that walked different
  // cases have nothing to pair — but this is the real cost, and it is written
  // down here so that raising the cap is weighed against it.
  it('stops judging race_opponent_summary against its probes', () => {
    const entry = agent('race_opponent_summary')
    const dropped = loadBackgroundCases(entry)
      .map((one) => one.caseId)
      .filter((id) => !walked(entry).includes(id))
    expect(walked(entry)).toEqual(['t1-baseline', 't2-conflict', 't3-noise'])
    expect(dropped).toEqual([
      't4-injection',
      't5-thin',
      't6-namesake',
      't7-stale',
      't9-zero_evidence_field',
      'control',
    ])
  })
})

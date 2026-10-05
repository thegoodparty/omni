import { hoursToMilliseconds } from 'date-fns'
import { describe, expect, it } from 'vitest'
import type { JsonJudgeModel } from '../../general/ordinance-flow/evals/coldJudge'
import type { LlmMessage } from '../../../llm/types/llmMessages.types'
import type { InvariantViolation } from './invariants'
import type { AgentEntry } from './agents'
import { createRng } from './bootstrap'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import {
  CHAT_PAIR,
  IDENTICAL_DIGEST_PAIR,
  TOOL_ERROR_PAIR,
  UNPINNED_VOTER_QUERY_PAIR,
  VOTER_QUERY_PAIR,
} from './fixtures/records'
import { judgeAll, OVERALL } from './judge'
import { normalizeAgent, type NormalizedAgent } from './normalize'
import { armGap } from './armGap'
import { coverageLines, renderReport, unpinnedMartReads } from './report'
import type { Cost, JsonValue, RunRecord } from './record'
import { scoreAgent, type AgentScore } from './score'

const [BASE, CANDIDATE] = CHAT_PAIR

const REGISTRY: readonly AgentEntry[] = [
  {
    agentId: 'chief_of_staff',
    shape: 'chat',
    cases: 'chief_of_staff.json',
    status: 'wired',
  },
  {
    agentId: 'meeting_briefing',
    shape: 'background',
    cases: null,
    status: 'pending',
  },
  {
    agentId: 'briefing_annotation',
    shape: 'chat',
    cases: null,
    status: 'blocked',
    blockedReason: 'no ChatScopeHandler yet',
  },
]

const EARLY = '2026-09-30T10:00:00.000Z'
const LATE = '2026-09-30T10:30:00.000Z'

const SHORT = 'Three priorities are on file.'
const LONG =
  'Three priorities are on file, housing has been open longest, and two ' +
  'have no target date.'

// A judge that reads the payload and nothing else, exactly as the real one
// does. It has no way to know which run is the candidate, so recovering a
// direction from it is a property of the blinding and the orientation
// composing correctly.
const userText = (messages: readonly LlmMessage[]): string => {
  const content = messages[1]?.content
  return typeof content === 'string' ? content : ''
}

const verdictFrom = (
  messages: readonly LlmMessage[],
  pick: (xBlock: string) => 'X' | 'Y',
): { verdict: 'X' | 'Y'; loc: string } => {
  const user = userText(messages)
  const xBlock = user.slice(
    user.indexOf('<run id="X"'),
    user.indexOf('<run id="Y"'),
  )
  const verdict = pick(xBlock)
  return { verdict, loc: `${verdict}.final` }
}

const respond = (verdict: 'X' | 'Y', loc: string): JsonValue => {
  const dimension = {
    reasoning: 'the fuller answer covers more of the question',
    evidence: [{ loc, quote: LONG, note: 'coverage' }],
    verdict,
    magnitude: 'clear',
  }
  return {
    rubric_version: 'uj-rubric-0.2',
    shared_observations: 'both arms answered the same question',
    dimensions: Object.fromEntries(
      DEFAULT_JUDGE_CONFIG.dimensions.map((d) => [d, dimension]),
    ),
    overall: dimension,
    flags: [],
    absolute_floor: {
      X_acceptable: 'yes',
      Y_acceptable: 'yes',
      note: 'both usable',
    },
  }
}

const longerWins: JsonJudgeModel = {
  jsonCompletion: async (options) => {
    const { verdict, loc } = verdictFrom(options.messages, (x) =>
      x.includes(LONG) ? 'X' : 'Y',
    )
    return {
      object: options.schema.parse(respond(verdict, loc)),
      tokens: 0,
      model: 'fake',
    }
  },
}

// A judge with no opinion about quality at all: it always names the first
// slot. Since the slots were assigned at random, this must produce no
// signal and must be caught by the position-consistency gate rather than
// reported as a verdict.
const alwaysX: JsonJudgeModel = {
  jsonCompletion: async (options) => ({
    object: options.schema.parse(respond('X', 'X.final')),
    tokens: 0,
    model: 'fake',
  }),
}

const withOutput = (record: RunRecord, value: string): RunRecord => ({
  ...record,
  output: { kind: 'text', value },
})

const sweepRecords = (count: number): RunRecord[] =>
  Array.from({ length: count }, (_, i) => i).flatMap((i) => [
    {
      ...withOutput(BASE, SHORT),
      caseId: `cos-case-${i}`,
      runId: `run_base_${i}`,
    },
    {
      ...withOutput(CANDIDATE, LONG),
      caseId: `cos-case-${i}`,
      runId: `run_cand_${i}`,
    },
  ])

const pipeline = async (
  records: readonly RunRecord[],
  config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
): Promise<AgentScore> => {
  const normalized = normalizeAgent(records, createRng(42), config)
  const judgments = await judgeAll(longerWins, normalized.judgeable, config)
  return scoreAgent({ normalized, judgments }, config)
}

describe('the coverage line', () => {
  // Asserted as an exact string. A pattern like /\d+ of \d+/ would pass
  // whichever registry got counted, which is the kind of test that looks
  // like coverage and is not.
  it('counts the wired agents against the judgeable ones', () => {
    expect(coverageLines(REGISTRY)[0]).toBe(
      '**Coverage: 1 of 2 agents wired (1 on placeholder inputs).**',
    )
  })

  // race_opponent_summary.json is the one case list not marked placeholder.
  it('leaves the placeholder count out when there is none', () => {
    const real: AgentEntry = {
      agentId: 'race_opponent_summary',
      shape: 'background',
      cases: 'race_opponent_summary.json',
      status: 'wired',
    }
    expect(coverageLines([real, ...REGISTRY.slice(1)])[0]).toBe(
      '**Coverage: 1 of 2 agents wired.**',
    )
  })

  // Wired and placeholder differ here, so the parenthetical cannot be
  // printing the wired count by mistake.
  it('counts placeholder inputs apart from wired', () => {
    const mixed: readonly AgentEntry[] = [
      ...REGISTRY,
      {
        agentId: 'race_opponent_summary',
        shape: 'background',
        cases: 'race_opponent_summary.json',
        status: 'wired',
      },
    ]
    expect(coverageLines(mixed)[0]).toBe(
      '**Coverage: 2 of 3 agents wired (1 on placeholder inputs).**',
    )
  })

  it('names every blocked agent and its reason', () => {
    expect(coverageLines(REGISTRY).slice(1)).toEqual([
      '- blocked: briefing_annotation — no ChatScopeHandler yet',
    ])
  })

  // The anti-stall mechanic: a gap nobody can see is a gap nobody closes,
  // so this prints even when the sweep produced nothing at all.
  it('prints even when no agent was judged', () => {
    const report = renderReport({ agents: [], registry: REGISTRY })
    expect(report).toContain(
      '**Coverage: 1 of 2 agents wired (1 on placeholder inputs).**',
    )
    expect(report).toContain('No agent produced a verdict')
  })
})

describe('the verdict', () => {
  it('recovers the better arm through the blind', async () => {
    const score = await pipeline(sweepRecords(25))
    expect(score.label).toBe('BETTER')
    const report = renderReport({ agents: [score], registry: REGISTRY })
    expect(report).toContain('### chief_of_staff — BETTER')
    expect(report).toContain('overall +1.00 [1.00, 1.00] over 25 cases')
  })

  it('shows a row per configured dimension plus overall', async () => {
    const score = await pipeline(sweepRecords(25))
    const report = renderReport({ agents: [score], registry: REGISTRY })
    for (const name of [OVERALL, ...DEFAULT_JUDGE_CONFIG.dimensions]) {
      expect(report).toContain(`| ${name} | +1.00 [1.00, 1.00] | 25 |`)
    }
  })
})

describe('a judge that reads position instead of quality', () => {
  // The whole reason for the order-swap subsample. A fixed slot preference
  // produces a delta of zero and zero consistency, and the gate has to
  // report that rather than dressing it up as equivalence.
  //
  // FIFTY CASES, because the gate needs gates.minSwappedPairs of them before
  // it will fail anything, and orderSwap.fraction 0.2 takes every fifth pair.
  // 25 cases is five swapped pairs, which is the sample the first live sweep
  // had and is not enough to tell a biased judge from a coin.
  it('is gated, not reported as a verdict', async () => {
    const normalized = normalizeAgent(sweepRecords(50), createRng(42))
    const judgments = await judgeAll(alwaysX, normalized.judgeable)
    const score = scoreAgent({ normalized, judgments })
    // The delta is NOT asserted. A fixed slot preference scores whichever arm
    // the rng put in X, so the delta depends on how the slots happened to
    // fall across the sample rather than on the bias — it was exactly 0 at 25
    // cases by coincidence of an even split. Zero consistency is the property
    // that actually identifies this judge.
    expect(score.positionConsistency).toBe(0)
    expect(score.swappedPairs).toBeGreaterThanOrEqual(
      DEFAULT_JUDGE_CONFIG.gates.minSwappedPairs,
    )
    expect(score.label).toBe("CAN'T SAY")
    expect(score.labelNote).toMatch(/reading position rather than quality/)
  })

  // The same biased judge on the sample a placeholder case list produces.
  // Still reported, and it no longer decides the verdict — the case floor
  // does, which is the honest reason at that size.
  it('is reported but not gated when too few pairs were swapped', async () => {
    const normalized = normalizeAgent(sweepRecords(25), createRng(42))
    const judgments = await judgeAll(alwaysX, normalized.judgeable)
    const score = scoreAgent({ normalized, judgments })
    expect(score.positionConsistency).toBe(0)
    expect(score.swappedPairs).toBeLessThan(
      DEFAULT_JUDGE_CONFIG.gates.minSwappedPairs,
    )
    expect(score.labelNote ?? '').not.toMatch(/reading position/)
    const report = renderReport({ agents: [score] })
    expect(report).toContain(`0 of ${score.swappedPairs} agreed`)
    expect(report).toContain('Too few swapped pairs to gate on')
  })
})

describe('the magnitude distribution and the flag counts', () => {
  it('reports magnitudes as a distribution, not as a weight', async () => {
    const score = await pipeline(sweepRecords(5))
    const report = renderReport({ agents: [score] })
    // Five pairs, all clear. Six judgments were made — the order-swap
    // subsample judged one pair twice — and the pair it looked at twice
    // still counts once, or the total would contradict the case count
    // printed two lines above it.
    expect(report).toContain('Overall magnitudes (per pair): 5 clear.')
  })

  it('counts flags by arm and type', async () => {
    const score = await pipeline(sweepRecords(3))
    const report = renderReport({
      agents: [
        {
          ...score,
          flags: [
            {
              arm: 'candidate',
              type: 'restricted_data',
              explanation: 'x',
              loc: undefined,
              caseId: 'cos-case-0',
            },
            {
              arm: 'base',
              type: 'restricted_data',
              explanation: 'x',
              loc: undefined,
              caseId: 'cos-case-1',
            },
            {
              arm: 'candidate',
              type: 'restricted_data',
              explanation: 'x',
              loc: undefined,
              caseId: 'cos-case-2',
            },
          ],
        },
      ],
    })
    expect(report).toContain(
      'Flags (cases affected): 2 on candidate restricted_data, ' +
        '1 on base restricted_data.',
    )
  })

  it('prints no flag line when there are none', async () => {
    const score = await pipeline(sweepRecords(3))
    expect(renderReport({ agents: [score] })).not.toContain('Flags (')
  })
})

// Three counters in score.ts have already had to be deduped per pair
// because the report prints them beside a per-case number. A line that
// leaves its unit to inference is how the next one hides, so the units are
// asserted here.
describe('the unit of every printed count', () => {
  it('labels the W/T/L and can-not-tell columns as per pair', async () => {
    const score = await pipeline(sweepRecords(5))
    const report = renderReport({ agents: [score] })
    expect(report).toContain(
      "| dimension | Δ (95% CI) | cases | W/T/L (pairs) | can't tell " +
        '(pairs) |',
    )
  })

  it('names the unit of the measured, floor and rate lines', async () => {
    const score = await pipeline(sweepRecords(5))
    const report = renderReport({
      agents: [
        {
          ...score,
          panelDisagreementRate: 0.2,
          floorFailures: [{ arm: 'candidate', caseId: 'cos-case-0' }],
          floorUnclear: [{ arm: 'base', caseId: 'cos-case-1' }],
        },
      ],
    })
    expect(report).toContain('- measured over 5 run pair(s)')
    expect(report).toContain('Position consistency across order-swapped pairs:')
    expect(report).toContain(
      'Panel disagreement on direction, per judgment: 20%',
    )
    expect(report).toContain('Absolute floor failed on 1 run(s), one per arm')
    expect(report).toContain('Absolute floor unclear on 1 run(s), one per arm')
  })

  it('says a candidate-only flag is counted once per case', async () => {
    const score = await pipeline(sweepRecords(3))
    const report = renderReport({
      agents: [
        {
          ...score,
          flags: [
            {
              arm: 'candidate',
              type: 'restricted_data',
              explanation: 'x',
              loc: undefined,
              caseId: 'cos-case-0',
            },
          ],
        },
      ],
    })
    expect(report).toContain(
      '1 flag(s) raised on the candidate only (counted once per case):',
    )
  })
})

describe('the measured layer', () => {
  it('prints cost, latency and tool errors as re-derived numbers', async () => {
    const score = await pipeline(sweepRecords(5))
    const report = renderReport({ agents: [score], registry: REGISTRY })
    // 31,213 input at $3/M plus 227 output at $15/M, on both arms.
    expect(report).toContain('- cost: +0.0000 USD per run pair')
    expect(report).toContain('(base 0.0970, candidate 0.0970)')
    expect(report).toContain('- latency: +0 ms per run pair')
    expect(report).toContain('- tool errors: +0.00 per run pair')
    expect(report).toContain('not read from the records stored dollars')
  })

  it('says so when the arms were priced under different tables', async () => {
    // `cost` is optional on a record; this test is about two arms priced
    // under different tables, so a fixture with no cost at all is a broken
    // fixture rather than the case under test.
    const costOf = (record: RunRecord): Cost => {
      const cost = record.telemetry.cost
      if (cost === undefined) {
        throw new Error(`${record.runId} has no cost to make stale`)
      }
      return cost
    }
    const stale = sweepRecords(2).map((record) =>
      record.arm === 'base'
        ? {
            ...record,
            telemetry: {
              ...record.telemetry,
              cost: { ...costOf(record), pricingVersion: '2025-01' },
            },
          }
        : record,
    )
    const report = renderReport({ agents: [await pipeline(stale)] })
    expect(report).toContain('pricing version mismatch between the arms')
  })
})

describe('exclusions', () => {
  it('counts tool error, infra error and ungraded apart', async () => {
    const records = [
      ...sweepRecords(3),
      ...TOOL_ERROR_PAIR,
      ...IDENTICAL_DIGEST_PAIR,
    ]
    const score = await pipeline(records)
    const report = renderReport({ agents: [score] })
    expect(report).toContain(
      'Excluded pairs: 1 tool error, 0 infra error, 1 identical ' +
        'config. Plus 0 unpaired record(s). Separately, 0 ungraded ' +
        'judgment(s)',
    )
    expect(report).toContain("which is not a CAN'T SAY verdict")
  })
})

describe('provenance', () => {
  it('links the verdict back to the PR and the workflow run', async () => {
    const score = await pipeline(sweepRecords(3))
    const report = renderReport({ agents: [score] })
    expect(report).toContain(
      'Change under test: thegoodparty/omni [#2198](https://github.com/thegoodparty/omni/pull/2198)',
    )
    expect(report).toContain(
      'https://github.com/thegoodparty/omni/actions/runs/36592029654',
    )
  })

  it('says plainly when a verdict cannot be traced to a PR', () => {
    const score: AgentScore = {
      agentId: 'chief_of_staff',
      shape: 'chat',
      label: "CAN'T SAY",
      labelNote: 'no judgments to score',
      overall: {
        delta: null,
        interval: null,
        cases: 0,
        judgments: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        cannotDetermine: 0,
        cannotDetermineJudgments: 0,
        magnitudes: { slight: 0, clear: 0, strong: 0 },
      },
      dimensions: {},
      regressions: [],
      exclusions: {
        ungradedReasons: [],
        toolErrorCauses: [],
        toolError: 0,
        infraError: 0,
        identicalConfig: 0,
        unpaired: 0,
        ungraded: 0,
      },
      positionConsistency: null,
      swappedPairs: 0,
      orderUnstablePairs: [],
      panelDisagreementRate: null,
      flags: [],
      floorFailures: [],
      floorUnclear: [],
      degradedPanel: null,
      evidence: {
        costUsd: null,
        unpriceableReason: null,
        latencyMs: { base: 0, candidate: 0, delta: 0 },
        toolErrors: { base: 0, candidate: 0, delta: 0 },
        pairs: 0,
        pricingMismatch: false,
        liveWebCases: 0,
      },
      ci: null,
    }
    const report = renderReport({ agents: [score] })
    expect(report).toContain('cannot be traced back to a pull request')
    expect(report).toContain('it came from a local run')
  })
})

describe('qualifiers', () => {
  it('states a candidate-only flag at the top of the section', async () => {
    const score = await pipeline(sweepRecords(3))
    const flagged: AgentScore = {
      ...score,
      flags: [
        {
          arm: 'candidate',
          type: 'restricted_data',
          explanation: 'named an individual voter',
          loc: 'Y.final',
          caseId: 'cos-case-0',
        },
      ],
    }
    const lines = renderReport({ agents: [flagged] }).split('\n')
    const heading = lines.findIndex((l) => l.startsWith('### '))
    expect(lines[heading + 2]).toContain(
      '1 flag(s) raised on the candidate only',
    )
    expect(lines[heading + 2]).toContain('restricted_data')
  })

  it('does not headline a flag that both arms raised', async () => {
    const score = await pipeline(sweepRecords(3))
    const flag = {
      type: 'other_severe',
      explanation: 'both did it',
      loc: undefined,
      caseId: 'cos-case-0',
    }
    const report = renderReport({
      agents: [
        {
          ...score,
          flags: [
            { ...flag, arm: 'candidate' as const },
            { ...flag, arm: 'base' as const },
          ],
        },
      ],
    })
    expect(report).not.toContain('raised on the candidate only')
  })

  it('names a regression without changing the verdict', async () => {
    const score = await pipeline(sweepRecords(25))
    const report = renderReport({
      agents: [{ ...score, regressions: ['user_utility'] }],
    })
    expect(report).toContain('### chief_of_staff — BETTER')
    expect(report).toContain('Regression on user_utility')
    expect(report).toContain('does not change it')
  })
})

describe('refusals', () => {
  it('reports an agent whose comparison was refused', () => {
    const report = renderReport({
      agents: [],
      refusals: [
        {
          agentId: 'ordinance_flow',
          reason: 'both arms hashed to the same config digest',
        },
      ],
      registry: REGISTRY,
    })
    expect(report).toContain('### ordinance_flow — refused')
    expect(report).toContain('both arms hashed to the same config digest')
    expect(report).toContain(
      '**Coverage: 1 of 2 agents wired (1 on placeholder inputs).**',
    )
  })
})

describe('a whole report', () => {
  it('reads as one document', async () => {
    const normalized: NormalizedAgent = normalizeAgent(
      [...sweepRecords(22), ...TOOL_ERROR_PAIR],
      createRng(42),
    )
    const judgments = await judgeAll(longerWins, normalized.judgeable)
    const score = scoreAgent({ normalized, judgments })
    const report = renderReport({ agents: [score], registry: REGISTRY })
    expect(report.startsWith('## Universal Judge')).toBe(true)
    // The coverage line is last and always present, so a truncated comment
    // is obvious rather than silently missing the anti-stall number.
    expect(report.trimEnd().endsWith('no ChatScopeHandler yet')).toBe(true)

    // The sections a reader needs, in the order they are meant to appear.
    const order = [
      '### chief_of_staff \u2014 BETTER',
      '| dimension |',
      'Measured, beside the verdict and never part of it',
      'Excluded pairs: 1 tool error',
      'Position consistency across order-swapped pairs:',
      'Change under test:',
      '**Coverage:',
    ]
    let cursor = -1
    for (const marker of order) {
      const at = report.indexOf(marker)
      expect(at, `missing section: ${marker}`).toBeGreaterThan(cursor)
      cursor = at
    }
  })
})

// THE WARNING THAT REPLACES A PIN NOBODY GOT.
//
// `JUDGE_DATA_VERSION` may be unset for an ordinary reason, and the sweep
// proceeds rather than refusing — most agents never touch the mart. What it
// must not do is proceed as though pinned. A record with `toolQueries` and no
// `dataVersion` is a run that read the live mart with nothing holding it
// still, and it is the only kind of run the missing pin can have moved.
describe('an unpinned voter mart', () => {
  it('names the runs that queried the mart with no version pinned', () => {
    const reads = unpinnedMartReads([...UNPINNED_VOTER_QUERY_PAIR])
    expect(reads).toEqual([
      {
        agentId: 'chief_of_staff',
        caseIds: ['cos-housing-support'],
        runs: 2,
      },
    ])
    const report = renderReport({ agents: [], unpinnedMart: reads })
    expect(report).toContain('The voter mart was not pinned to one version.')
    expect(report).toContain(
      'chief_of_staff: 2 run(s) queried the mart unpinned',
    )
    expect(report).toContain('may belong to the data moving')
  })

  // A pinned run carries the version it read, so there is nothing to warn
  // about and a warning printed anyway would train readers to ignore it.
  it('says nothing when the runs that queried the mart were pinned', () => {
    expect(unpinnedMartReads([...VOTER_QUERY_PAIR])).toEqual([])
    expect(renderReport({ agents: [] })).not.toContain(
      'The voter mart was not pinned',
    )
  })

  // The distinction the whole warning turns on: an unpinned sweep whose runs
  // never queried a versioned table lost nothing, and CHAT_PAIR is that run.
  it('ignores a run that queried nothing versioned', () => {
    expect(unpinnedMartReads([...CHAT_PAIR])).toEqual([])
  })

  it('counts every run but lists each case once', () => {
    const [base, candidate] = UNPINNED_VOTER_QUERY_PAIR
    const reads = unpinnedMartReads([
      base,
      candidate,
      { ...base, runId: 'run_retry_base', attempt: 2 },
      { ...candidate, caseId: 'cos-turnout', runId: 'run_turnout_cand' },
    ])
    expect(reads).toEqual([
      {
        agentId: 'chief_of_staff',
        caseIds: ['cos-housing-support', 'cos-turnout'],
        runs: 4,
      },
    ])
  })

  it('reports each agent separately, since a verdict is per agent', () => {
    const [base] = UNPINNED_VOTER_QUERY_PAIR
    const reads = unpinnedMartReads([
      base,
      { ...base, agentId: 'priority_flow', runId: 'run_pf' },
    ])
    expect(reads.map((read) => read.agentId)).toEqual([
      'chief_of_staff',
      'priority_flow',
    ])
    const report = renderReport({ agents: [], unpinnedMart: reads })
    expect(report).toContain('priority_flow: 1 run(s)')
    // Said ONCE, however many agents it qualifies.
    expect(
      report.split('The voter mart was not pinned to one version.'),
    ).toHaveLength(2)
  })

  // Ahead of the per-agent sections a reader may stop after, and beside the
  // placeholder warning rather than at the foot with the arm gap.
  it('lands before the arm-capture windows', async () => {
    const score = await pipeline(sweepRecords(6))
    const report = renderReport({
      agents: [score],
      unpinnedMart: unpinnedMartReads([...UNPINNED_VOTER_QUERY_PAIR]),
      armGap: armGap(
        { startedAt: EARLY, endedAt: EARLY },
        { startedAt: LATE, endedAt: LATE },
        hoursToMilliseconds(6),
      ),
    })
    const at = report.indexOf('The voter mart was not pinned')
    // Both found, then ordered: a block that vanished would have an index of
    // -1, which is "before" everything and would pass a bare comparison.
    expect(at).toBeGreaterThan(0)
    expect(at).toBeLessThan(report.indexOf('### Arm capture windows'))
  })
})

// The panel reduction judge.ts records is only a defect if a reader can see
// it. These pin both halves: that it prints, and that it does NOT print when
// the panel was whole — a warning that always appears is a warning readers
// learn to skip past.
describe('a reduced judge panel', () => {
  it('says nothing when every judgment had every seat', async () => {
    const score = await pipeline(sweepRecords(3))
    expect(score.degradedPanel).toBeNull()
    const report = renderReport({ agents: [score] })
    expect(report).not.toContain('reduced judge panel')
  })

  it('names the agent, the judgments and the seats, once', async () => {
    const score = await pipeline(sweepRecords(3))
    const report = renderReport({
      agents: [
        {
          ...score,
          degradedPanel: { judgments: 2, seats: ['claude-opus-4-8'] },
        },
      ],
    })
    expect(report).toContain('Some verdicts came from a reduced judge panel')
    expect(report).toContain(
      '> - chief_of_staff: 2 judgment(s) ran without seat(s) ' +
        'claude-opus-4-8',
    )
    // Once per agent, not once per judgment: two degraded judgments here.
    expect(report.split('chief_of_staff: 2 judgment(s)')).toHaveLength(2)
  })

  it('warns for the degraded agent, not its whole-panel sibling', async () => {
    const score = await pipeline(sweepRecords(3))
    const report = renderReport({
      agents: [
        { ...score, degradedPanel: { judgments: 1, seats: ['seat-two'] } },
        { ...score, agentId: 'meeting_briefing' },
      ],
    })
    expect(report).toContain('> - chief_of_staff: 1 judgment(s)')
    expect(report).not.toContain('> - meeting_briefing:')
  })

  // The reduction makes the seats agree more easily, so the rate printed in
  // each agent section is a floor. That makes this a verdict qualifier, which
  // is a different thing from the report's reference sections: it belongs
  // beside the other two qualifiers and ahead of the tables a reader consults
  // rather than reads. Pinned against both neighbours, because "somewhere
  // before the footer" is satisfied by every position in the report.
  it('sits with the qualifiers, above the reference tables', async () => {
    const score = await pipeline(sweepRecords(3))
    const report = renderReport({
      agents: [
        {
          ...score,
          degradedPanel: { judgments: 1, seats: ['seat-two'] },
        },
      ],
      unpinnedMart: unpinnedMartReads([...UNPINNED_VOTER_QUERY_PAIR]),
      identicalOutputs: [
        {
          agentId: 'chief_of_staff',
          identical: 1,
          of: 3,
          allIdentical: false,
          caseIds: ['cos-case-0'],
        },
      ],
      armGap: armGap(
        { startedAt: EARLY, endedAt: EARLY },
        { startedAt: LATE, endedAt: LATE },
        hoursToMilliseconds(6),
      ),
    })
    const at = {
      unpinned: report.indexOf('The voter mart was not pinned'),
      degraded: report.indexOf('reduced judge panel'),
      identical: report.indexOf('### Identical outputs'),
      footer: report.indexOf('### Arm capture windows'),
    }
    // Every one found first: a block that vanished would index at -1, which
    // sorts before everything and passes a bare comparison.
    for (const [name, index] of Object.entries(at)) {
      expect(index, name).toBeGreaterThan(0)
    }
    expect(at.unpinned).toBeLessThan(at.degraded)
    expect(at.degraded).toBeLessThan(at.identical)
    expect(at.identical).toBeLessThan(at.footer)
  })
})

// A warning that always appears is a warning readers learn to skip, so this
// block has to be absent on the ordinary report and present on the one it
// qualifies. Absence cannot fail by itself, so the pair is asserted together
// and a renderer that always printed was tried against both.
describe('the seeded-transcript warning', () => {
  it('names the agent and the cases whose context was written for it', async () => {
    const report = renderReport({
      agents: [await pipeline(sweepRecords(25))],
      registry: REGISTRY,
      seededTranscripts: [
        { agentId: 'chief_of_staff', caseIds: ['mid-conversation', 'follow'] },
      ],
    })
    expect(report).toContain(
      '**Seeded transcripts:** chief_of_staff (follow, mid-conversation)',
    )
    expect(report).toContain('production did not build the whole context')
  })

  it('prints nothing when production built every context', async () => {
    expect(
      renderReport({
        agents: [await pipeline(sweepRecords(25))],
        registry: REGISTRY,
      }),
    ).not.toContain('Seeded transcripts')
  })

  // Beside the placeholder warning rather than at the foot: both qualify what
  // the verdicts above can be read to mean, and a reader who stops after the
  // first agent section has to have seen whichever applies.
  it('sits with the placeholder warning, ahead of the refusals', async () => {
    const report = renderReport({
      agents: [await pipeline(sweepRecords(25))],
      registry: REGISTRY,
      placeholderCases: ['chief_of_staff'],
      seededTranscripts: [
        { agentId: 'chief_of_staff', caseIds: ['mid-conversation'] },
      ],
      refusals: [{ agentId: 'campaign_assistant', reason: 'identical' }],
    })
    const lines = report.split('\n')
    const placeholderAt = lines.findIndex((line) =>
      line.includes('Placeholder inputs'),
    )
    const seededAt = lines.findIndex((line) =>
      line.includes('Seeded transcripts'),
    )
    const refusalAt = lines.findIndex((line) => line.includes('— refused'))
    expect(placeholderAt).toBeGreaterThan(-1)
    expect(seededAt).toBe(placeholderAt + 2)
    expect(refusalAt).toBeGreaterThan(seededAt)
  })
})

// On an `auto` sweep these two facts are refusals and never reach the report,
// so every assertion here is about the explicit path — where the qualifier is
// all a reader gets in place of one.
describe('the identical-config qualifier', () => {
  const NOTICE = {
    agentId: 'chief_of_staff',
    caseIds: ['cos-case-0'],
    digestSetsMatch: true,
  }

  // The wording is the deliverable, not decoration: it is carrying the weight
  // the refusal used to, so it has to say what the digest covers and therefore
  // what a matching digest does not rule out.
  it('says what the digest covers and what it cannot see', async () => {
    const report = renderReport({
      agents: [await pipeline(sweepRecords(25))],
      registry: REGISTRY,
      identicalConfigs: [NOTICE],
    })
    expect(report).toContain(
      'The two arms were configured identically, as far as the digest can ' +
        'see.',
    )
    expect(report).toContain('the rendered system prompt')
    expect(report).toContain('the names of the tools the agent was offered')
    expect(report).toContain('A change to the model, the provider')
    expect(report).toContain('about whatever the digest')
    expect(report).toContain(
      '> - chief_of_staff: both arms produced the same set of digests; ' +
        'judged case(s) cos-case-0',
    )
  })

  // Some pairs matching and others not is a far narrower claim than the two
  // arms' whole digest sets matching, and a line that read the same for both
  // would overstate it.
  it('scopes some matching pairs apart from matching sets', async () => {
    const report = renderReport({
      agents: [await pipeline(sweepRecords(25))],
      registry: REGISTRY,
      identicalConfigs: [{ ...NOTICE, digestSetsMatch: false }],
    })
    expect(report).toContain(
      '> - chief_of_staff: some pairs hashed alike and some did not; ' +
        'judged case(s) cos-case-0',
    )
    expect(report).not.toContain('the same set of digests')
  })

  // THE SET CHECK IS NOT A PAIR CHECK. It compares the two arms' digest SETS,
  // so a branch that permuted digests across cases satisfies it while no pair
  // matched at all — and the line must not then claim every pair hashed
  // alike, next to verdicts for pairs that genuinely differed.
  it('does not read matching sets as matching pairs', async () => {
    const report = renderReport({
      agents: [await pipeline(sweepRecords(25))],
      registry: REGISTRY,
      identicalConfigs: [{ ...NOTICE, caseIds: [] }],
    })
    expect(report).toContain(
      '> - chief_of_staff: both arms produced the same set of digests; no ' +
        'pair of it both hashed alike and reached a verdict',
    )
    expect(report).not.toContain('judged case(s)')
  })

  // A warning that always appears is one readers learn to skip. Absence cannot
  // fail by itself, so this is asserted over the same report the test above
  // builds minus the one field: a renderer that printed unconditionally would
  // pass that test and fail this one.
  it('prints nothing when the digests genuinely differ', async () => {
    const report = renderReport({
      agents: [await pipeline(sweepRecords(25))],
      registry: REGISTRY,
    })
    expect(report).not.toContain('as far as the digest can see')
    expect(report).not.toContain('hashed alike')
    expect(report).not.toContain('the same set of digests')
  })

  // Beside the other verdict qualifiers and ahead of the reference tables, for
  // the reason the degraded-panel block is: on an explicit sweep this IS the
  // refusal that did not happen, so a reader who stops before the tables has
  // to have met it. Pinned against both neighbours, because "somewhere above
  // the footer" is satisfied by almost every position in the report.
  it('sits with the qualifiers, above refusals and tables', async () => {
    const report = renderReport({
      agents: [await pipeline(sweepRecords(25))],
      registry: REGISTRY,
      placeholderCases: ['chief_of_staff'],
      identicalConfigs: [NOTICE],
      identicalOutputsReported: ['chief_of_staff'],
      refusals: [{ agentId: 'meeting_briefing', reason: 'nothing to compare' }],
      identicalOutputs: [
        {
          agentId: 'chief_of_staff',
          identical: 1,
          of: 25,
          allIdentical: false,
          caseIds: ['cos-case-0'],
        },
      ],
    })
    const at = {
      placeholder: report.indexOf('Placeholder inputs'),
      config: report.indexOf('as far as the digest can see'),
      outputs: report.indexOf('came back byte-identical for'),
      refusal: report.indexOf('— refused'),
      table: report.indexOf('### Identical outputs'),
    }
    // Every one found first: a block that vanished would index at -1, which
    // sorts before everything and passes a bare comparison.
    for (const [name, index] of Object.entries(at)) {
      expect(index, name).toBeGreaterThan(0)
    }
    expect(at.placeholder).toBeLessThan(at.config)
    expect(at.config).toBeLessThan(at.outputs)
    expect(at.outputs).toBeLessThan(at.refusal)
    expect(at.refusal).toBeLessThan(at.table)
  })
})

describe('the all-identical-outputs qualifier', () => {
  it('names the agents and what it cannot rule out', async () => {
    const report = renderReport({
      agents: [await pipeline(sweepRecords(25))],
      registry: REGISTRY,
      identicalOutputsReported: ['chief_of_staff', 'meeting_briefing'],
    })
    expect(report).toContain(
      'Every judgeable pair came back byte-identical for: chief_of_staff, ' +
        'meeting_briefing.',
    )
    expect(report).toContain('a legitimate SAME')
    expect(report).toContain('the commit under test')
  })

  it('prints nothing when some pair differed', async () => {
    const report = renderReport({
      agents: [await pipeline(sweepRecords(25))],
      registry: REGISTRY,
    })
    expect(report).not.toContain('came back byte-identical for')
  })

  // The table's own closing sentence used to promise a refusal above it, which
  // on this path does not exist. It has to describe both outcomes or it tells
  // a reader to go looking for something that is not there.
  //
  // The ORDINARY fixture, one matching pair out of 25: that sentence is a
  // static part of the table and not a branch, so an all-identical fixture
  // here would imply a conditional that does not exist.
  it('leaves the table honest about both outcomes', async () => {
    const report = renderReport({
      agents: [await pipeline(sweepRecords(25))],
      registry: REGISTRY,
      identicalOutputs: [
        {
          agentId: 'chief_of_staff',
          identical: 1,
          of: 25,
          allIdentical: false,
          caseIds: ['cos-case-0'],
        },
      ],
    })
    expect(report).toContain('qualified above rather than read as SAME')
  })
})

// The same failure for tool errors: "Excluded pairs: 9 tool error" and no way
// to tell which tool, or why, without a diagnostic branch.
describe('tool-error exclusions say which tool and why', () => {
  const withCauses = async (
    toolErrorCauses: AgentScore['exclusions']['toolErrorCauses'],
  ): Promise<string> => {
    const base = await pipeline(sweepRecords(3))
    return renderReport({
      agents: [
        { ...base, exclusions: { ...base.exclusions, toolErrorCauses } },
      ],
    })
  }

  it('lists each cause under the exclusion line', async () => {
    const report = await withCauses([
      {
        tool: 'Bash',
        errorClass: 'KeyError',
        pairs: 9,
        arms: ['base', 'candidate'],
      },
      { tool: 'Read', errorClass: 'exit code 1', pairs: 1, arms: ['base'] },
    ])
    const lines = report.split('\n')
    const at = lines.findIndex((line) => line.startsWith('Excluded pairs:'))
    expect(lines.slice(at + 1, at + 3)).toEqual([
      '- chief_of_staff: `Bash` — KeyError (×9, base and candidate)',
      '- chief_of_staff: `Read` — exit code 1 (×1, base)',
    ])
  })

  it('shows five causes and counts the rest', async () => {
    const report = await withCauses(
      Array.from({ length: 7 }, (_, i) => ({
        tool: `tool${i}`,
        errorClass: 'other',
        pairs: 1,
        arms: ['candidate' as const],
      })),
    )
    expect(report).toContain('`tool4`')
    expect(report).not.toContain('`tool5`')
    expect(report).toContain('- and 2 more')
  })

  it('adds nothing when no pair was excluded for a tool error', async () => {
    const report = await withCauses([])
    const lines = report.split('\n')
    const at = lines.findIndex((line) => line.startsWith('Excluded pairs:'))
    expect(lines[at + 1]).toBe('')
  })

  // THE PUBLIC-PAGE GUARANTEE, end to end. omni is public and this report
  // reaches the run log and the step summary. Each message below is the
  // kind of thing a tool really prints, carrying voter data or a secret that
  // redaction cannot be trusted to recognise. None of it may reach the page:
  // only the tool name and a fixed error class do.
  it('never prints error text, whatever the record holds', async () => {
    const leaks = [
      'Jane',
      '123 Oak St',
      'Jane Smith, 742 Evergreen Terrace',
      '555-867-5309',
      '078-05-1120',
      'QWxhZGRpbjpvcGVuIHNlc2FtZQ==',
      'warehouse.cloud.internal',
      'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      'PARAMS_JSON',
    ]
    const messages = [
      "statement failed: SELECT * FROM voters WHERE first_name='Jane' " +
        "AND address='123 Oak St'",
      'Exit code 1\nTraceback (most recent call last):\n' +
        "KeyError: 'Jane Smith, 742 Evergreen Terrace'",
      'no voter at 555-867-5309 or 078-05-1120',
      'Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==',
      'could not reach warehouse.cloud.internal:8443',
      'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      "KeyError: 'PARAMS_JSON'",
    ]
    const records = messages.flatMap((message, i) =>
      [BASE, CANDIDATE].map((record) => ({
        ...record,
        caseId: `leak-${i}`,
        runId: `run_${record.arm}_leak_${i}`,
        agentShape: 'background' as const,
        telemetry: { ...record.telemetry, toolCalls: 1, toolErrors: 1 },
        toolErrorDetails: [{ tool: 'Bash', message }],
      })),
    )
    const report = renderReport({
      agents: [await pipeline([...sweepRecords(3), ...records])],
    })

    expect(report).toContain('`Bash` — KeyError (×2, base and candidate)')
    for (const leak of leaks) expect(report).not.toContain(leak)
  })
})

// A COUNT WITHOUT A CAUSE SENT SOMEBODY BACK TO REPRODUCE THE RUN. The first
// live sweep's report said "29 ungraded judgment(s)" and stopped there; the
// reason was on every judgment and never reached the page.
describe('ungraded judgments say why', () => {
  const withUngraded = async (
    ungraded: number,
    ungradedReasons: readonly string[],
  ): Promise<string> => {
    const base = await pipeline(sweepRecords(3))
    return renderReport({
      agents: [
        {
          ...base,
          exclusions: { ...base.exclusions, ungraded, ungradedReasons },
        },
      ],
    })
  }

  it('prints the reason beside the count', async () => {
    const report = await withUngraded(29, [
      'seat claude-sonnet-4-6 returned no verdict for task_success',
    ])
    expect(report).toContain('29 ungraded judgment(s)')
    expect(report).toContain(
      'Why: seat claude-sonnet-4-6 returned no verdict for task_success',
    )
  })

  it('joins several distinct reasons', async () => {
    const report = await withUngraded(2, ['rate limited', 'no verdict'])
    expect(report).toContain('Why: rate limited | no verdict')
  })

  // Nothing failed, so there is nothing to explain and the clause would be
  // noise on every clean report.
  it('says nothing when no judgment was ungraded', async () => {
    const report = await withUngraded(0, [])
    expect(report).toContain('0 ungraded judgment(s)')
    expect(report).not.toContain('Why:')
  })

  // The opposite defect: a reason list that somehow arrives non-empty with a
  // zero count must not print either, or a clean sweep grows a dangling
  // explanation for a failure that did not happen.
  it('says nothing when the count is zero even if reasons survive', async () => {
    const report = await withUngraded(0, ['stale reason'])
    expect(report).not.toContain('Why:')
    expect(report).not.toContain('stale reason')
  })
})

// THE ONE QUALIFIER A PAIRWISE VERDICT STRUCTURALLY CANNOT CARRY. Delete a
// rule from an agent's prompt and the outputs that follow usually read better
// — a vocabulary constraint costs directness — so the delta moves TOWARD the
// candidate and the regression is reported as an improvement. The live sweep
// did exactly that: overall +0.44 toward a candidate whose only change was
// deleting the constituents-not-voters rule, with instruction_adherence flat
// at +0.02. These lines are what a reader needs beside that number.
describe('a rule the candidate broke', () => {
  const violation = (over: Partial<InvariantViolation> = {}) => ({
    agentId: 'chief_of_staff',
    invariant: 'constituents-not-voters',
    describe: 'The people the user serves are constituents, never voters.',
    baseRuns: 0,
    candidateRuns: 2,
    candidateCaseIds: ['capability-inventory-from-context'],
    baseUnknownRuns: 0,
    candidateUnknownRuns: 0,
    ...over,
  })

  const render = (violations: InvariantViolation[]): string =>
    renderReport({ agents: [], invariantViolations: violations })

  it('is stated as a fact, and says the delta will not show it', async () => {
    const report = render([violation()])
    expect(report).toContain('The candidate broke a rule the base kept')
    expect(report).toContain('the delta above will not show it')
    expect(report).toContain('constituents-not-voters')
    expect(report).toContain('capability-inventory-from-context')
    // The rule itself, so a reader who has not read the prompt knows what
    // was broken.
    expect(report).toContain('never voters')
  })

  // A rule BOTH arms break is a standing bug, not something this branch did.
  // Reporting it under the same headline would send someone to review a diff
  // that did not cause it.
  it('is not called a regression when both arms broke it', () => {
    const report = render([violation({ baseRuns: 3, candidateRuns: 2 })])
    expect(report).not.toContain('The candidate broke a rule the base kept')
    expect(report).toContain('broken by BOTH arms')
    expect(report).toContain('standing problem')
  })

  // The opposite direction, and worth printing: the branch fixed something
  // the comparison also cannot see.
  it('says so when only the base broke it', () => {
    const report = render([
      violation({ baseRuns: 4, candidateRuns: 0, candidateCaseIds: [] }),
    ])
    expect(report).not.toContain('The candidate broke a rule the base kept')
    expect(report).toContain('this branch fixing it')
  })

  it('prints nothing at all when every rule held', () => {
    const report = renderReport({ agents: [] })
    expect(report).not.toContain('broke a rule')
    expect(report).not.toContain('standing problem')
  })

  // Three facts from one list, so a sweep that hit all three says all three
  // rather than collapsing them into the loudest.
  it('keeps the three cases apart in one report', () => {
    const report = render([
      violation({ invariant: 'new-break' }),
      violation({ invariant: 'both-break', baseRuns: 1, candidateRuns: 1 }),
      violation({
        invariant: 'base-only',
        baseRuns: 2,
        candidateRuns: 0,
        candidateCaseIds: [],
      }),
    ])
    expect(report).toContain('The candidate broke a rule the base kept')
    expect(report).toContain('new-break')
    expect(report).toContain('broken by BOTH arms')
    expect(report).toContain('this branch fixing it')
  })
})

// "The base kept it" is a claim, and a base arm that produced no answer does
// not support it. The finding stands — the candidate broke the rule — but the
// comparison behind the headline is weaker, and the line has to say so.
describe('a base arm that never answered', () => {
  const render = (over: Partial<InvariantViolation>): string =>
    renderReport({
      agents: [],
      invariantViolations: [
        {
          agentId: 'chief_of_staff',
          invariant: 'constituents-not-voters',
          describe: 'The people the user serves are constituents.',
          baseRuns: 0,
          candidateRuns: 2,
          candidateCaseIds: ['priorities-on-file'],
          baseUnknownRuns: 0,
          candidateUnknownRuns: 0,
          ...over,
        },
      ],
    })

  it('says the base claim is unverified to that extent', () => {
    const report = render({ baseUnknownRuns: 3 })
    expect(report).toContain('The candidate broke a rule the base kept')
    expect(report).toContain('The base produced no answer on 3 run(s)')
    expect(report).toContain('unverified')
  })

  it('says nothing extra when the base answered every run', () => {
    const report = render({ baseUnknownRuns: 0 })
    expect(report).toContain('The candidate broke a rule the base kept')
    expect(report).not.toContain('produced no answer')
    expect(report).not.toContain('unverified')
  })
})

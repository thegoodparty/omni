import { describe, expect, it } from 'vitest'
import type { JsonJudgeModel } from '../../general/ordinance-flow/evals/coldJudge'
import type { LlmMessage } from '../../../llm/types/llmMessages.types'
import type { AgentEntry } from './agents'
import { createRng } from './bootstrap'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import { CHAT_PAIR, TOOL_ERROR_PAIR } from './fixtures/records'
import { judgeAll, OVERALL } from './judge'
import { normalizeAgent, type NormalizedAgent } from './normalize'
import { coverageLines, renderReport } from './report'
import type { JsonValue, RunRecord } from './record'
import { scoreAgent, type AgentScore } from './score'

const [BASE, CANDIDATE] = CHAT_PAIR

const REGISTRY: readonly AgentEntry[] = [
  {
    agentId: 'chief_of_staff',
    shape: 'chat',
    cases: 'cos.yaml',
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
      '**Coverage: 1 of 2 agents wired.**',
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
    expect(report).toContain('**Coverage: 1 of 2 agents wired.**')
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
  it('is gated, not reported as a verdict', async () => {
    const normalized = normalizeAgent(sweepRecords(25), createRng(42))
    const judgments = await judgeAll(alwaysX, normalized.judgeable)
    const score = scoreAgent({ normalized, judgments })
    expect(score.overall.delta).toBe(0)
    expect(score.positionConsistency).toBe(0)
    expect(score.label).toBe("CAN'T SAY")
    expect(score.labelNote).toMatch(/reading position rather than quality/)
  })
})

describe('the magnitude distribution and the flag counts', () => {
  it('reports magnitudes as a distribution, not as a weight', async () => {
    const score = await pipeline(sweepRecords(5))
    const report = renderReport({ agents: [score] })
    // Five primary judgments plus one order swap, all clear.
    expect(report).toContain('Overall magnitudes: 6 clear.')
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
      'Flags: 2 on candidate restricted_data, 1 on base restricted_data.',
    )
  })

  it('prints no flag line when there are none', async () => {
    const score = await pipeline(sweepRecords(3))
    expect(renderReport({ agents: [score] })).not.toContain('Flags:')
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
    const stale = sweepRecords(2).map((record) =>
      record.arm === 'base'
        ? {
            ...record,
            telemetry: {
              ...record.telemetry,
              cost: { ...record.telemetry.cost, pricingVersion: '2025-01' },
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
    const records = [...sweepRecords(3), ...TOOL_ERROR_PAIR]
    const score = await pipeline(records)
    const report = renderReport({ agents: [score] })
    expect(report).toContain(
      'Excluded: 1 tool error, 0 infra error, 0 unpaired. Separately, ' +
        '0 ungraded',
    )
    expect(report).toContain("which is not a CAN'T SAY verdict")
  })
})

describe('provenance', () => {
  it('links the verdict back to the PR and the workflow run', async () => {
    const score = await pipeline(sweepRecords(3))
    const report = renderReport({ agents: [score] })
    expect(report).toContain('Change under test: thegoodparty/omni #2198')
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
        magnitudes: { slight: 0, clear: 0, strong: 0 },
      },
      dimensions: {},
      regressions: [],
      exclusions: { toolError: 0, infraError: 0, unpaired: 0, ungraded: 0 },
      positionConsistency: null,
      orderUnstablePairs: [],
      panelDisagreementRate: null,
      flags: [],
      floorFailures: [],
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
    expect(report).toContain('**Coverage: 1 of 2 agents wired.**')
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
      'Excluded: 1 tool error',
      'Position consistency:',
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

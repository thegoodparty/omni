import { describe, expect, it } from 'vitest'
import { AGENTS, type AgentEntry } from './agents'
import { CaseListError } from './cases'
import { selectAgents } from './cli'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import {
  backgroundRunCents,
  baseChatAttemptsIn,
  estimateAgent,
  MEASURED_BACKGROUND_RUN_COST,
  MEASURED_CHAT_TURN_COST,
  priceAgainstBase,
  UNMEASURED_BACKGROUND_RUN_CENTS,
  type EstimateFn,
} from './planCost'

const background = (agentId: string): AgentEntry => ({
  agentId,
  shape: 'background',
  cases: `${agentId}.json`,
  status: 'pending',
})

const withBudget = (
  budget: Partial<JudgeConfig['background']>,
): JudgeConfig => ({
  ...DEFAULT_JUDGE_CONFIG,
  background: { ...DEFAULT_JUDGE_CONFIG.background, ...budget },
})

const cases = (count: number) => ({ countCases: (): number => count })

describe('backgroundRunCents', () => {
  // The larger arm's mean x1.5, rounded up to the next $0.50.
  it.each([
    ['race_opponent_summary', 100],
    ['opposition_research', 50],
    ['meeting_briefing', 200],
    ['top_community_issues', 200],
    ['trending_issues', 150],
  ])('prices %s from its measured judge cost', (agentId, cents) => {
    const run = backgroundRunCents(agentId)
    expect(run.cents).toBe(cents)
    expect(run.measured).toBeDefined()
  })

  it('prices an unmeasured agent at the production worst case', () => {
    expect(backgroundRunCents('self_research')).toEqual({
      cents: UNMEASURED_BACKGROUND_RUN_CENTS,
      measured: undefined,
    })
    expect(UNMEASURED_BACKGROUND_RUN_CENTS).toBe(800)
  })

  it('uses the more expensive arm', () => {
    const measured = {
      x: {
        runUrl: 'https://github.com/thegoodparty/omni/actions/runs/1',
        date: '2026-10-05',
        baseUsd: 0.1,
        candidateUsd: 0.7,
        pairs: 3,
      },
    }
    // 0.7 x 1.5 = 1.05, up to 1.50.
    expect(backgroundRunCents('x', measured).cents).toBe(150)
  })
})

describe('the measured table', () => {
  it.each(Object.entries(MEASURED_BACKGROUND_RUN_COST))(
    '%s carries its evidence and is a registered background agent',
    (agentId, entry) => {
      expect(entry?.runUrl).toMatch(
        /^https:\/\/github\.com\/thegoodparty\/omni\/actions\/runs\/\d+$/,
      )
      expect(entry?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(entry?.pairs).toBeGreaterThan(0)
      expect(AGENTS.find((a) => a.agentId === agentId)?.shape).toBe(
        'background',
      )
    },
  )
})

describe('estimateAgent for a background agent', () => {
  it('prices from the measured table', () => {
    const estimate = estimateAgent(
      background('race_opponent_summary'),
      withBudget({ maxCases: 3, attemptsPerCase: 1 }),
      cases(9),
    )
    expect(estimate).toMatchObject({ cents: 600, basis: 'measured' })
    expect(estimate.why).toContain('2 arms x 3 of 9 cases x 1 attempt x $1.00')
    expect(estimate.why).toContain('37380598839')
  })

  it('falls back to the worst case for an unmeasured agent, and says so', () => {
    const estimate = estimateAgent(
      background('self_research'),
      withBudget({ maxCases: 3, attemptsPerCase: 1 }),
      cases(8),
    )
    expect(estimate).toMatchObject({ cents: 4800, basis: 'unmeasured' })
    expect(estimate.why).toContain('unmeasured')
  })

  describe('runs min(case list, maxCases)', () => {
    const agent = background('race_opponent_summary')
    it.each([
      ['9 cases at a cap of 3', 9, 3, 600],
      ['9 cases at a cap of 9', 9, 9, 1800],
      ['2 cases at a cap of 3', 2, 3, 400],
      ['9 cases and no cap', 9, undefined, 1800],
    ])('%s', (_name, listed, maxCases, cents) => {
      expect(
        estimateAgent(
          agent,
          withBudget({ maxCases, attemptsPerCase: 1 }),
          cases(listed),
        ).cents,
      ).toBe(cents)
    })
  })

  it('multiplies by attempts per case', () => {
    expect(
      estimateAgent(
        background('race_opponent_summary'),
        withBudget({ maxCases: 3, attemptsPerCase: 3 }),
        cases(9),
      ).cents,
    ).toBe(1800)
  })

  // Admission refuses it on both arms, so nothing is spent on it.
  it('prices an unreadable case list at nothing, and says why', () => {
    const estimate = estimateAgent(
      background('race_opponent_summary'),
      DEFAULT_JUDGE_CONFIG,
      {
        countCases: () => {
          throw new CaseListError('broken')
        },
      },
    )
    expect(estimate).toMatchObject({ cents: 0, basis: 'unreadable' })
  })

  it('does not swallow an error that is not about the case list', () => {
    expect(() =>
      estimateAgent(background('race_opponent_summary'), DEFAULT_JUDGE_CONFIG, {
        countCases: () => {
          throw new Error('bug')
        },
      }),
    ).toThrow('bug')
  })

  it('reads the real case list by default', () => {
    expect(
      estimateAgent(
        background('race_opponent_summary'),
        withBudget({ maxCases: 9 }),
      ).cents,
    ).toBe(1800)
  })
})

describe('estimateAgent for a chat agent', () => {
  const chat = (agentId: string): AgentEntry => ({
    agentId,
    shape: 'chat',
    cases: `${agentId}.json`,
    status: 'pending',
  })
  const turns = (count: number) => ({ countTurns: (): number => count })

  // 2 arms x 8 turns x 3 attempts x $0.123 = $5.904, x1.5 = $8.86, up to $9.
  it('prices from the measured turn cost, on the whole sweep', () => {
    expect(estimateAgent(chat('chief_of_staff'))).toMatchObject({
      cents: 900,
      basis: 'measured',
    })
  })

  // 2 x 8 x 3 x $0.52 = $24.96, x1.5 = $37.44, up to $37.50.
  it('prices an unmeasured agent at the costliest turn, and says so', () => {
    expect(estimateAgent(chat('ordinance_flow'))).toMatchObject({
      cents: 3750,
      basis: 'unmeasured',
    })
  })

  it('counts turns, not cases', () => {
    expect(
      estimateAgent(chat('chief_of_staff'), DEFAULT_JUDGE_CONFIG, turns(16))
        .cents,
    ).toBe(1800)
  })

  it('multiplies by chat attempts per case', () => {
    expect(
      estimateAgent(
        chat('chief_of_staff'),
        { ...DEFAULT_JUDGE_CONFIG, attemptsPerCase: 1 },
        turns(8),
      ).cents,
    ).toBe(300)
  })

  it('reads the chat attempts out of a base config.ts', () => {
    expect(baseChatAttemptsIn('  attemptsPerCase: 5,\n')).toBe(5)
    expect(baseChatAttemptsIn('nothing here')).toBeUndefined()
  })
})

describe('priceAgainstBase', () => {
  const agent = background('race_opponent_summary')
  const config = withBudget({ maxCases: 3, attemptsPerCase: 1 })
  // THE PR LOWERS ITS OWN PRICE: its table says a run costs a cent.
  const lowered: EstimateFn = (one, cfg) =>
    estimateAgent(one, cfg, {
      background: {
        race_opponent_summary: {
          runUrl: 'https://github.com/thegoodparty/omni/actions/runs/1',
          date: '2026-10-06',
          baseUsd: 0.01,
          candidateUsd: 0.01,
          pairs: 3,
        },
      },
    })

  it('keeps the base price when the branch lowers its own', () => {
    expect(lowered(agent, config).cents).toBe(300)
    const priced = priceAgainstBase(estimateAgent, config, lowered)(agent)
    expect(priced.cents).toBe(600)
    expect(priced.why).toContain("the base ref's price")
  })

  it('keeps the branch price when it is the higher', () => {
    expect(priceAgainstBase(lowered, config)(agent).cents).toBe(600)
  })

  it.each([
    ['there is no base pricing', undefined],
    [
      'the base pricing throws',
      (() => {
        throw new Error('no such export')
      }) as EstimateFn,
    ],
    [
      'the base pricing returns nonsense',
      (() => ({ cents: -1, basis: 'measured', why: '' })) as EstimateFn,
    ],
  ])('prices at the worst case when %s', (_name, base) => {
    expect(priceAgainstBase(base, config)(agent)).toMatchObject({
      cents: 4800,
      basis: 'base-unread',
    })
  })
})

describe('the measured chat table', () => {
  it.each(Object.entries(MEASURED_CHAT_TURN_COST))(
    '%s is a registered chat agent',
    (agentId) => {
      expect(AGENTS.find((a) => a.agentId === agentId)?.shape).toBe('chat')
    },
  )
})

it('prices an agent with no case list at nothing', () => {
  expect(estimateAgent({ ...background('x'), cases: null })).toMatchObject({
    cents: 0,
    basis: 'no-case-list',
  })
})

// THE NUMBER ON AN ACCIDENTAL `all`. Pinned, so a change to the table, the
// margin, the budget or a case list that moves it is a visible diff here and
// in the comments that quote it (judge.yml, judge-comment.yml, README).
it('prices `all` at $643.50', () => {
  const total = selectAgents({ kind: 'all' })
    .selected.map((agent) => estimateAgent(agent).cents)
    .reduce((sum, cents) => sum + cents, 0)
  expect(total).toBe(64_350)
})

import { describe, expect, it } from 'vitest'
import { AGENTS, type AgentEntry } from './agents'
import { CaseListError } from './cases'
import { selectAgents } from './cli'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './config'
import {
  backgroundRunCents,
  estimateAgent,
  MEASURED_BACKGROUND_RUN_COST,
  UNMEASURED_BACKGROUND_RUN_CENTS,
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

const cases = (count: number) => (): number => count

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
      () => {
        throw new CaseListError('broken')
      },
    )
    expect(estimate).toMatchObject({ cents: 0, basis: 'unreadable' })
  })

  it('does not swallow an error that is not about the case list', () => {
    expect(() =>
      estimateAgent(
        background('race_opponent_summary'),
        DEFAULT_JUDGE_CONFIG,
        () => {
          throw new Error('bug')
        },
      ),
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

  it('prices a chat agent at the design doc figure', () => {
    expect(estimateAgent(chat('chief_of_staff'))).toMatchObject({
      cents: 700,
      basis: 'design-doc',
    })
  })

  it('prices ordinance_flow at five times that', () => {
    expect(estimateAgent(chat('ordinance_flow')).cents).toBe(3500)
  })
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
it('prices `all` at $578', () => {
  const total = selectAgents({ kind: 'all' })
    .selected.map((agent) => estimateAgent(agent).cents)
    .reduce((sum, cents) => sum + cents, 0)
  expect(total).toBe(57_800)
})

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENTS, type AgentEntry } from './agents'
import { budgetOutputLines, resolveAdmission } from './armBudget'
import {
  DEFAULT_JUDGE_CONFIG,
  type JudgeConfig,
  type ShapeBudget,
} from './config'
import { armEnvFor } from './fixtures/sweep'
import { ARM_BUDGET_MS, armCaseLoader } from './runners/backgroundDispatch'
import { SWEEP_VALUES } from './fixtures/sweep'
import { armConfigFor, parseArmEnv, SweepEnvError } from './sweepEnv'

// THE BUDGET AND THE ADMITTED LIST CROSS A SEAM: armBudget.ts writes them in
// one process, judge.yml carries them through $GITHUB_OUTPUT into two other
// processes, and sweepEnv.ts reads them back in each. A test of either end
// alone cannot see the two disagreeing about the format — and a value an arm
// cannot read falls back to that arm's own decision, which is the per-
// checkout disagreement this input exists to end.
//
// So these round-trip, and every fixture DIFFERS from the default: a round
// trip through the default proves nothing, because an arm that ignored the
// input entirely would still arrive at it.

const REPO_ROOT = join(__dirname, '../../../../../..')

const PARSE = (lines: string): NodeJS.ProcessEnv => {
  const out: NodeJS.ProcessEnv = {}
  for (const line of lines.split('\n')) {
    const at = line.indexOf('=')
    if (at > 0) out[line.slice(0, at)] = line.slice(at + 1)
  }
  return out
}

// How judge.yml maps the step's outputs onto both arms' env. judgeWorkflow.
// test.ts pins that the YAML says exactly this.
const intoArmEnv = (outputs: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  armEnvFor({
    JUDGE_BACKGROUND_ATTEMPTS: outputs.attempts,
    JUDGE_BACKGROUND_MAX_CASES: outputs.max_cases,
    JUDGE_BACKGROUND_ADMITTED: outputs.admitted,
  })

const configWith = (background: ShapeBudget): JudgeConfig => ({
  ...DEFAULT_JUDGE_CONFIG,
  background,
})

describe('the budget and the admitted list survive the trip to both arms', () => {
  it.each<[string, ShapeBudget, string[]]>([
    ['a capped budget', { attemptsPerCase: 2, maxCases: 5 }, ['a', 'b']],
    ['an uncapped budget', { attemptsPerCase: 4 }, ['only_one']],
  ])('carries %s through intact', (_label, budget, admitted) => {
    const arm = parseArmEnv(
      intoArmEnv(PARSE(budgetOutputLines(configWith(budget), admitted))),
    )
    expect(arm.backgroundBudget).toEqual(budget)
    expect(armConfigFor(arm).background).toEqual(budget)
    expect([...(arm.backgroundAdmitted ?? [])]).toEqual(admitted)
  })

  // EMPTY IS NOT ABSENT. The resolver admitting nothing prints `admitted=`,
  // which GitHub hands over as an empty string — and that has to arrive as
  // "none admitted", never as "decide for yourself".
  it('carries an empty admission as none, not as undecided', () => {
    const arm = parseArmEnv(
      intoArmEnv(
        PARSE(budgetOutputLines(configWith({ attemptsPerCase: 2 }), [])),
      ),
    )
    expect(arm.backgroundAdmitted).toEqual(new Set())
  })

  // THE REAL ENTRY, run the way the workflow runs it, against two real trees.
  // Base is this repository, so the two arms' costs are equal and the answer
  // has to match what the arm's own loader admits — which ties the resolver
  // to the arm rather than to a second copy of the arithmetic.
  it('writes what the arms read when run as the workflow runs it', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'budget-')), 'github-output')
    execFileSync('npx', ['tsx', join(__dirname, 'armBudget.ts'), out], {
      cwd: join(__dirname, '../../../..'),
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        BASE_DIR: REPO_ROOT,
        JUDGE_AGENTS: 'chief_of_staff,meeting_briefing,opposition_research',
      },
    })
    const arm = parseArmEnv(intoArmEnv(PARSE(readFileSync(out, 'utf8'))))
    expect(arm.backgroundBudget).toEqual(DEFAULT_JUDGE_CONFIG.background)
    // meeting_briefing is three 65-minute polls; opposition_research fits.
    expect([...(arm.backgroundAdmitted ?? [])]).toEqual(['opposition_research'])
  })
})

describe('resolveAdmission', () => {
  const agent = (agentId: string): AgentEntry => ({
    agentId,
    shape: 'background',
    cases: `${agentId}.json`,
    status: 'wired',
  })
  const registry = [agent('a'), agent('b'), { ...agent('none'), cases: null }]
  const minutes = (n: number) => n * 60 * 1000

  // THE SLOWER ARM DECIDES. A branch that LOWERS a timeout would otherwise be
  // admitted on the candidate's number and then overrun the base arm at the
  // base's, killing it mid-walk with no manifest written.
  it('admits an agent only if it fits on whichever arm is slower', () => {
    const result = resolveAdmission(
      ['a'],
      '/base',
      DEFAULT_JUDGE_CONFIG,
      registry,
      {
        candidate: () => minutes(30),
        base: () => minutes(90),
      },
    )
    expect(result.admitted).toEqual([])
    expect(result.refused[0]?.reason).toMatch(
      /would take 90 minutes on the slower arm/,
    )
  })

  // Nothing to compare against, so nobody pays for the candidate's half.
  it('refuses an agent the base ref does not have, before anyone pays', () => {
    const result = resolveAdmission(
      ['a'],
      '/base',
      DEFAULT_JUDGE_CONFIG,
      registry,
      {
        candidate: () => minutes(10),
        base: () => undefined,
      },
    )
    expect(result.refused).toEqual([
      { agentId: 'a', reason: expect.stringMatching(/not on the base ref/) },
    ])
  })

  // PER AGENT. One agent this branch cannot read must be refused by name —
  // throwing would fail the step and every chat agent in the sweep with it.
  it('refuses one unreadable agent and still decides the rest', () => {
    const result = resolveAdmission(
      ['a', 'b'],
      '/base',
      DEFAULT_JUDGE_CONFIG,
      registry,
      {
        candidate: (one) => {
          if (one.agentId === 'a')
            throw new Error('manifest has no timeout_seconds')
          return minutes(10)
        },
        base: () => minutes(10),
      },
    )
    expect(result.admitted).toEqual(['b'])
    expect(result.refused[0]?.reason).toMatch(/manifest has no timeout_seconds/)
  })

  it('names a missing case list as that, not as a missing base', () => {
    const result = resolveAdmission(
      ['none'],
      '/base',
      DEFAULT_JUDGE_CONFIG,
      registry,
      {
        candidate: () => minutes(10),
        base: () => minutes(10),
      },
    )
    expect(result.refused[0]?.reason).toMatch(/has no case list/)
  })

  // Against the REAL registry with base = this repository: the resolver's
  // answer must equal what the arm's own loader admits walking the same
  // agents in the same order, or the two paths have drifted apart.
  it('agrees with the arm loader on the real registry when the arms are identical', () => {
    const ids = AGENTS.filter(
      (one) => one.shape === 'background' && one.status !== 'blocked',
    ).map((one) => one.agentId)
    const resolved = resolveAdmission(ids, REPO_ROOT).admitted
    const loader = armCaseLoader(
      SWEEP_VALUES,
      ARM_BUDGET_MS,
      DEFAULT_JUDGE_CONFIG,
    )
    const walked = AGENTS.filter((one) => ids.includes(one.agentId)).filter(
      (one) => {
        try {
          loader(one)
          return true
        } catch {
          return false
        }
      },
    )
    expect(resolved).toEqual(walked.map((one) => one.agentId))
    expect(resolved.length).toBeGreaterThan(0)
  })
})

describe('reading the budget an arm was handed', () => {
  // No input means a local run: the arm's own config, and no admitted set, so
  // the arm decides admission itself.
  it('leaves the arm on its own config when nothing was resolved', () => {
    const base = configWith({ attemptsPerCase: 7, maxCases: 9 })
    const arm = parseArmEnv(armEnvFor())
    expect(arm.backgroundBudget).toBeUndefined()
    expect(arm.backgroundAdmitted).toBeUndefined()
    // An explicit, non-default base: compared against the default, "uses
    // base" and "ignores base" could not be told apart.
    expect(armConfigFor(arm, base)).toBe(base)
  })

  // Only `background` is replaced. A wholesale swap would also reset the
  // chat attempts and the gates to whatever the arm's checkout says.
  it('replaces the background budget and nothing else', () => {
    const base = { ...configWith({ attemptsPerCase: 7 }), attemptsPerCase: 6 }
    const arm = parseArmEnv(
      armEnvFor({
        JUDGE_BACKGROUND_ATTEMPTS: '2',
        JUDGE_BACKGROUND_MAX_CASES: '5',
      }),
    )
    const config = armConfigFor(arm, base)
    expect(config.background).toEqual({ attemptsPerCase: 2, maxCases: 5 })
    expect({ ...config, background: undefined }).toEqual({
      ...base,
      background: undefined,
    })
  })

  // Half a budget silently falls back to the arm's own decision — the
  // per-checkout mismatch again — so each half on its own is refused.
  it.each(['JUDGE_BACKGROUND_MAX_CASES', 'JUDGE_BACKGROUND_ADMITTED'])(
    'refuses %s with no attempts',
    (name) => {
      expect(() => parseArmEnv(armEnvFor({ [name]: '3' }))).toThrow(
        /half a budget/,
      )
    },
  )

  // Everything z.coerce.number() would have let through as something nobody
  // wrote: "" as 0, "1.5" as a fraction of a case, "1e1" as ten.
  it.each(['0', '-1', '1.5', '1e1', 'three', '3x'])(
    'refuses %j as a count',
    (raw) => {
      expect(() =>
        parseArmEnv(armEnvFor({ JUDGE_BACKGROUND_ATTEMPTS: raw })),
      ).toThrow(SweepEnvError)
      expect(() =>
        parseArmEnv(
          armEnvFor({
            JUDGE_BACKGROUND_ATTEMPTS: '1',
            JUDGE_BACKGROUND_MAX_CASES: raw,
          }),
        ),
      ).toThrow(SweepEnvError)
    },
  )
})

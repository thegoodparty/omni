import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENTS, findAgent, type AgentEntry } from './agents'
import {
  BASE_HONOURS_ADMISSION,
  budgetOutputLines,
  resolveAdmission,
} from './armBudget'
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

// A BASE TREE THAT IS NOT THIS ONE. Every test that pointed the resolver's
// base at this repository could not see the base read at all: the resolver
// takes the larger of the two arms' costs, so a base read that returned 0,
// swallowed an error, or read the candidate's tree instead all produced the
// same answer. This builds a separate tree with exactly the files the raw
// base read looks at, with timeouts chosen to differ from the candidate's.
const baseTree = (spec: {
  honours?: boolean
  timeouts: Record<string, number>
}): string => {
  const root = mkdtempSync(join(tmpdir(), 'base-tree-'))
  const judgeDir = join(root, 'packages/gp-api/src/chats/evals/judge')
  mkdirSync(join(judgeDir, 'cases'), { recursive: true })
  // An arm that predates shared admission still HAS a sweepEnv.ts — today's
  // main does — so "old" is a file without the marker, not a missing file.
  writeFileSync(
    join(judgeDir, 'sweepEnv.ts'),
    spec.honours === false
      ? '// an arm that decides background admission for itself\n'
      : `// reads ${BASE_HONOURS_ADMISSION}\n`,
  )
  for (const [agentId, timeout] of Object.entries(spec.timeouts)) {
    const cases = findAgent(agentId)?.cases
    if (!cases) throw new Error(`${agentId} has no case list to copy`)
    const experiment = join(root, 'packages/runbooks/experiments', agentId)
    mkdirSync(experiment, { recursive: true })
    writeFileSync(
      join(experiment, 'manifest.json'),
      JSON.stringify({ timeout_seconds: timeout }),
    )
    copyFileSync(
      join(__dirname, 'cases', cases),
      join(judgeDir, 'cases', cases),
    )
  }
  return root
}

// The entry run exactly as judge.yml runs it, with stderr kept: the refusal
// reasons a reader of the job log gets are printed there.
const runEntry = (env: NodeJS.ProcessEnv) => {
  const out = join(mkdtempSync(join(tmpdir(), 'budget-')), 'github-output')
  const result = spawnSync(
    'npx',
    ['tsx', join(__dirname, 'armBudget.ts'), out],
    {
      cwd: join(__dirname, '../../../..'),
      encoding: 'utf8',
      env: { ...process.env, ...env },
    },
  )
  let written = ''
  try {
    written = readFileSync(out, 'utf8')
  } catch {
    written = ''
  }
  return { status: result.status, stderr: result.stderr, written }
}

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
    JUDGE_BACKGROUND_REFUSED: outputs.refused,
    JUDGE_ARM_BUDGET_MS: outputs.arm_budget_ms,
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

  // A REASON CAN SAY ANYTHING — a zod message is several lines, and a reason
  // can quote. It has to arrive whole, on the one line $GITHUB_OUTPUT allows,
  // or the report would name a refusal it cannot explain.
  it('carries each refusal reason and the arm budget through intact', () => {
    const reason =
      'cannot be read on this branch: [\n  "expected number" = here\n]'
    const arm = parseArmEnv(
      intoArmEnv(
        PARSE(
          budgetOutputLines(
            configWith({ attemptsPerCase: 2 }),
            ['kept'],
            [{ agentId: 'dropped', reason }],
            81 * 60 * 1000,
          ),
        ),
      ),
    )
    expect(arm.backgroundRefused?.get('dropped')).toBe(reason)
    expect(arm.armBudgetMs).toBe(81 * 60 * 1000)
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

describe('the resolver run against a base tree that differs', () => {
  // THE BASE IS SLOWER. Its own timeout, not the candidate's, has to decide —
  // and only a base tree that differs from the candidate can show it.
  it('refuses an agent that only the base arm cannot fit', () => {
    const { status, stderr, written } = runEntry({
      BASE_DIR: baseTree({ timeouts: { opposition_research: 3600 } }),
      JUDGE_AGENTS: 'opposition_research',
    })
    expect(status).toBe(0)
    expect(written).toMatch(/^admitted=$/m)
    expect(stderr).toMatch(
      /refused opposition_research: would take 195 minutes/,
    )
  })

  it('refuses an agent the base ref does not have, and admits one it does', () => {
    const { written, stderr } = runEntry({
      BASE_DIR: baseTree({ timeouts: { race_opponent_actions: 600 } }),
      JUDGE_AGENTS: 'opposition_research,race_opponent_actions',
    })
    expect(written).toMatch(/^admitted=race_opponent_actions$/m)
    expect(stderr).toMatch(/refused opposition_research: is not on the base/)
  })

  // TODAY'S MAIN, in effect: the file exists, the marker does not. An empty
  // directory would not model it, and a probe that only checked the file was
  // there passed against one.
  it('refuses everything against a base whose arm predates shared admission', () => {
    const { written, stderr } = runEntry({
      BASE_DIR: baseTree({
        honours: false,
        timeouts: { opposition_research: 600 },
      }),
      JUDGE_AGENTS: 'opposition_research',
    })
    expect(written).toMatch(/^admitted=$/m)
    expect(stderr).toMatch(/predates shared background admission/)
  })

  // An unset base is a usage error, not a base with nothing on it: the latter
  // would refuse every agent as "not on the base ref" and exit 0.
  it('exits as a usage error when no base worktree is named', () => {
    const { status } = runEntry({
      BASE_DIR: '',
      JUDGE_AGENTS: 'opposition_research',
    })
    expect(status).toBe(2)
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
        honoursAdmission: () => true,
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
        honoursAdmission: () => true,
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
        honoursAdmission: () => true,
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
        honoursAdmission: () => true,
      },
    )
    expect(result.refused[0]?.reason).toMatch(/has no case list/)
  })

  // THE SAME SELECTION AS THE ARM. A duplicate the arm drops must not be
  // counted twice here: at 30 minutes each against 70, 'a' twice leaves 10
  // and refuses 'b', which the arm would then never be told it could walk.
  it('selects exactly what the arm selects when an id repeats', () => {
    const result = resolveAdmission(
      ['a', 'a', 'b'],
      '/base',
      DEFAULT_JUDGE_CONFIG,
      registry,
      {
        candidate: () => minutes(30),
        base: () => minutes(30),
        honoursAdmission: () => true,
      },
    )
    expect(result.admitted).toEqual(['a', 'b'])
  })

  // ATTEMPTS ON THE BASE SIDE. At 1 attempt, dropping attempts from the base
  // cost changed nothing; at 2 it is the whole difference between 45 minutes
  // that fit and 90 that do not.
  it('multiplies the base arm by attempts too', () => {
    const config = {
      ...DEFAULT_JUDGE_CONFIG,
      background: { attemptsPerCase: 2, maxCases: 1 },
    }
    const result = resolveAdmission(
      ['opposition_research'],
      baseTree({ timeouts: { opposition_research: 2400 } }),
      config,
    )
    expect(result.admitted).toEqual([])
    expect(result.refused[0]?.reason).toMatch(/would take 90 minutes/)
  })

  // THE CANDIDATE IS SLOWER — a branch that raised a timeout. Here the
  // candidate's cost is the one that wins the max, so it is the only test that
  // can see the candidate side drop attempts: everywhere else the base was at
  // least as slow, and an understated candidate never won. At 2 attempts
  // meeting_briefing is 130 minutes and refused; at 1 it would be 65 and
  // wrongly admitted to an arm it then overruns.
  it('multiplies the candidate arm by attempts when the candidate is slower', () => {
    const config = {
      ...DEFAULT_JUDGE_CONFIG,
      background: { attemptsPerCase: 2, maxCases: 1 },
    }
    const result = resolveAdmission(
      ['meeting_briefing'],
      baseTree({ timeouts: { meeting_briefing: 60 } }),
      config,
    )
    expect(result.admitted).toEqual([])
    expect(result.refused[0]?.reason).toMatch(/would take 130 minutes/)
  })

  // A BASE THAT WILL NOT OBEY. Its arm ignores the admitted list and walks
  // every background agent at its own old budget, refusing each one; the
  // candidate would run them, and once a fixture is minted that is paid work
  // pairing with nothing. So nothing is admitted and every one says why.
  it('admits nothing when the base ref predates shared admission', () => {
    const result = resolveAdmission(
      ['a', 'b'],
      '/base',
      DEFAULT_JUDGE_CONFIG,
      registry,
      {
        candidate: () => minutes(1),
        base: () => minutes(1),
        honoursAdmission: () => false,
      },
    )
    expect(result.admitted).toEqual([])
    expect(result.refused.map((one) => one.agentId)).toEqual(['a', 'b'])
    expect(result.refused[0]?.reason).toMatch(
      /predates shared background admission/,
    )
  })

  // The real probe, both ways: this tree honours admission, and an empty
  // directory — a base ref older than any of this — does not.
  it('probes the real base tree for whether its arm reads the admitted list', () => {
    const empty = mkdtempSync(join(tmpdir(), 'old-base-'))
    expect(
      resolveAdmission(['opposition_research'], REPO_ROOT).admitted,
    ).toEqual(['opposition_research'])
    expect(
      resolveAdmission(['opposition_research'], empty).refused[0]?.reason,
    ).toMatch(/predates shared background admission/)
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

  // The same agreement at 2 attempts. At the default of 1, both cost paths
  // could drop attempts entirely and still agree — and an arm handed an
  // admitted set no longer checks its own budget, so the resolver is the only
  // guard there is. Pinned to the measured answer as well as to the loader.
  it('agrees with the arm loader at a budget where attempts change the answer', () => {
    const config = {
      ...DEFAULT_JUDGE_CONFIG,
      background: { attemptsPerCase: 2, maxCases: 1 },
    }
    const ids = AGENTS.filter(
      (one) => one.shape === 'background' && one.status !== 'blocked',
    ).map((one) => one.agentId)
    const resolved = resolveAdmission(ids, REPO_ROOT, config).admitted
    const loader = armCaseLoader(SWEEP_VALUES, ARM_BUDGET_MS, config)
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
    expect(resolved).toEqual(['campaign_tracker_tasks'])
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
  it.each([
    'JUDGE_BACKGROUND_MAX_CASES',
    'JUDGE_BACKGROUND_ADMITTED',
    'JUDGE_BACKGROUND_REFUSED',
    'JUDGE_ARM_BUDGET_MS',
  ])('refuses %s with no attempts', (name) => {
    expect(() => parseArmEnv(armEnvFor({ [name]: '3' }))).toThrow(
      /half a budget/,
    )
  })

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

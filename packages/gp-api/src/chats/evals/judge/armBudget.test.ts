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
  BASE_BOUNDS_CHAT,
  BASE_HONOURS_ADMISSION,
  BASE_WALKS_CONCURRENTLY,
  baseWalksConcurrently,
  budgetOutputLines,
  resolveAdmission,
} from './armBudget'
import {
  DEFAULT_JUDGE_CONFIG,
  type JudgeConfig,
  type ShapeBudget,
} from './config'
import { armEnvFor } from './fixtures/sweep'
import {
  ARM_BUDGET_MS,
  armCaseLoader,
  armDeps,
  capturableAgents,
} from './runners/backgroundDispatch'
import { SWEEP_VALUES } from './fixtures/sweep'
import {
  armConfigFor,
  armTimeoutMs,
  parseArmEnv,
  SweepEnvError,
} from './sweepEnv'

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

// WHAT AN ARM'S ENV SCHEMA LOOKS LIKE, old and new. Today's main carries
// fifteen real `JUDGE_` keys, so an "old" fixture with none would let a probe
// that only looked for the prefix pass against the very base it exists to
// refuse. The old one also mentions the marker in a COMMENT, so a probe that
// matched any mention fails too: only a schema key means the arm reads it.
const OLD_ARM_SCHEMA = [
  'const ArmEnvSchema = SweepEnvSchema.extend({',
  '  // JUDGE_BACKGROUND_ADMITTED is not read by this arm',
  '  JUDGE_SWEEP_ID: SweepIdSchema,',
  '  JUDGE_AGENTS: AgentIdsSchema,',
  '  JUDGE_RECORDS_DIR: NON_EMPTY.optional(),',
  '  JUDGE_DATA_VERSION: BLANK_IS_UNSET,',
  '})',
  '',
].join('\n')
const NEW_ARM_SCHEMA = OLD_ARM_SCHEMA.replace(
  '})',
  '  JUDGE_BACKGROUND_ADMITTED: BLANK_IS_UNSET,\n})',
)

// A BASE TREE THAT IS NOT THIS ONE. Every test that pointed the resolver's
// base at this repository could not see the base read at all: the resolver
// takes the larger of the two arms' costs, so a base read that returned 0,
// swallowed an error, or read the candidate's tree instead all produced the
// same answer. This builds a separate tree with exactly the files the raw
// base read looks at, with timeouts chosen to differ from the candidate's.
// WHAT AN ARM'S WALK DECLARES, old and new. The old one names the constant in
// a comment, so a probe that matched any mention would pass against it.
const OLD_ARM_WALK = [
  '// BACKGROUND_WALKS_CONCURRENTLY is not declared by this arm',
  'export const captureArm = async () => {}',
  '',
].join('\n')
const NEW_ARM_WALK = `${OLD_ARM_WALK}export const BACKGROUND_WALKS_CONCURRENTLY = true\n`

const baseTree = (spec: {
  honours?: boolean
  // Whether the base arm starts its background runs at once. Absent means it
  // does not, the base this branch is first merged against.
  concurrent?: boolean
  timeouts: Record<string, number>
  // Replaces the copied case list with one holding exactly these ids — how a
  // base ref whose list differs from the branch's is modelled.
  caseIds?: Record<string, string[]>
  // Whether the base arm refuses the chat agents it is told to.
  boundsChat?: boolean
  // A chat agent's case list on the base, as a number of cases.
  chatCases?: Record<string, number>
}): string => {
  const root = mkdtempSync(join(tmpdir(), 'base-tree-'))
  const judgeDir = join(root, 'packages/gp-api/src/chats/evals/judge')
  mkdirSync(join(judgeDir, 'cases'), { recursive: true })
  writeFileSync(
    join(judgeDir, 'sweepEnv.ts'),
    spec.honours === false ? OLD_ARM_SCHEMA : NEW_ARM_SCHEMA,
  )
  writeFileSync(
    join(judgeDir, 'sweepArm.ts'),
    spec.concurrent === true ? NEW_ARM_WALK : OLD_ARM_WALK,
  )
  if (spec.boundsChat === true) {
    mkdirSync(join(judgeDir, 'runners'))
    writeFileSync(
      join(judgeDir, 'runners/backgroundDispatch.ts'),
      'export const CHAT_TIME_BOUNDED = true\n',
    )
  }
  for (const [agentId, count] of Object.entries(spec.chatCases ?? {})) {
    writeFileSync(
      join(judgeDir, 'cases', `${agentId}.json`),
      JSON.stringify({
        cases: Array.from({ length: count }, (_, i) => ({ caseId: `c${i}` })),
      }),
    )
  }
  for (const [agentId, timeout] of Object.entries(spec.timeouts)) {
    const cases = findAgent(agentId)?.cases
    if (!cases) throw new Error(`${agentId} has no case list to copy`)
    const experiment = join(root, 'packages/runbooks/experiments', agentId)
    mkdirSync(experiment, { recursive: true })
    writeFileSync(
      join(experiment, 'manifest.json'),
      JSON.stringify({ timeout_seconds: timeout }),
    )
    const ids = spec.caseIds?.[agentId]
    if (ids === undefined) {
      copyFileSync(
        join(__dirname, 'cases', cases),
        join(judgeDir, 'cases', cases),
      )
    } else {
      writeFileSync(
        join(judgeDir, 'cases', cases),
        JSON.stringify({ cases: ids.map((caseId) => ({ caseId })) }),
      )
    }
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

// The slots are the arm's own and never travel, so every fixture carries the
// default's and only the two numbers that do travel vary.
const configWith = (
  background: Omit<ShapeBudget, 'maxInFlight'>,
): JudgeConfig => ({
  ...DEFAULT_JUDGE_CONFIG,
  background: {
    ...background,
    maxInFlight: DEFAULT_JUDGE_CONFIG.background.maxInFlight,
  },
})

describe('the budget and the admitted list survive the trip to both arms', () => {
  it.each<[string, Omit<ShapeBudget, 'maxInFlight'>, string[]]>([
    ['a capped budget', { attemptsPerCase: 2, maxCases: 5 }, ['a', 'b']],
    ['an uncapped budget', { attemptsPerCase: 4 }, ['only_one']],
  ])('carries %s through intact', (_label, budget, admitted) => {
    const arm = parseArmEnv(
      intoArmEnv(PARSE(budgetOutputLines(configWith(budget), admitted))),
    )
    expect(arm.backgroundBudget).toEqual(budget)
    expect(armConfigFor(arm).background).toEqual({
      ...budget,
      maxInFlight: DEFAULT_JUDGE_CONFIG.background.maxInFlight,
    })
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

  // Several at once, and the characters a reason can actually carry. Exact,
  // so an extra or duplicated key does not pass.
  it('carries several reasons with awkward characters exactly', () => {
    const refused = [
      {
        agentId: 'one',
        reason: '  leading space, a café, and a \r\n line break',
      },
      { agentId: 'two', reason: 'quotes "inside" and an = sign' },
    ]
    const arm = parseArmEnv(
      intoArmEnv(
        PARSE(
          budgetOutputLines(configWith({ attemptsPerCase: 2 }), [], refused),
        ),
      ),
    )
    expect(arm.backgroundRefused).toEqual(
      new Map(refused.map((one) => [one.agentId, one.reason])),
    )
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
    expect(arm.backgroundRefused).toEqual(new Map())
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
        JUDGE_AGENTS:
          'chief_of_staff,find_existing_ordinances,opposition_research',
      },
    })
    const arm = parseArmEnv(intoArmEnv(PARSE(readFileSync(out, 'utf8'))))
    const { attemptsPerCase, maxCases } = DEFAULT_JUDGE_CONFIG.background
    expect(arm.backgroundBudget).toEqual({ attemptsPerCase, maxCases })
    // This tree walks concurrently, so find_existing_ordinances's three
    // 55-minute runs finish together inside the arm, and both agents fit the
    // slots.
    expect([...(arm.backgroundAdmitted ?? [])]).toEqual([
      'find_existing_ordinances',
      'opposition_research',
    ])
  })
})

describe('the probe for whether the base arm reads the admitted list', () => {
  it('finds the schema key in this branch', () => {
    expect(
      BASE_HONOURS_ADMISSION.test(
        readFileSync(join(__dirname, 'sweepEnv.ts'), 'utf8'),
      ),
    ).toBe(true)
  })

  it.each([
    ['an old arm schema with other JUDGE_ keys', OLD_ARM_SCHEMA],
    ['the name in a comment', '  // JUDGE_BACKGROUND_ADMITTED\n'],
    ['the name as a string in a list', "    'JUDGE_BACKGROUND_ADMITTED',\n"],
    [
      'the name read off a parsed object',
      '  (data.JUDGE_BACKGROUND_ADMITTED ?? x)\n',
    ],
  ])('does not mistake %s for an arm that reads it', (_label, text) => {
    expect(BASE_HONOURS_ADMISSION.test(text)).toBe(false)
  })
})

describe('the probe for whether the base arm walks concurrently', () => {
  it('finds the declaration in this branch', () => {
    expect(
      BASE_WALKS_CONCURRENTLY.test(
        readFileSync(join(__dirname, 'sweepArm.ts'), 'utf8'),
      ),
    ).toBe(true)
  })

  it.each([
    ['an old arm walk that names it in a comment', OLD_ARM_WALK],
    ['the name in a string', "  'BACKGROUND_WALKS_CONCURRENTLY',\n"],
    [
      'a declaration that says false',
      'export const BACKGROUND_WALKS_CONCURRENTLY = false\n',
    ],
  ])('does not mistake %s for an arm that does', (_label, text) => {
    expect(BASE_WALKS_CONCURRENTLY.test(text)).toBe(false)
  })

  // A base whose walk cannot be read is one that does not walk concurrently:
  // assuming it does is the one mistake the fallback exists to prevent.
  it('reads a base it cannot read as walking one run after another', () => {
    expect(baseWalksConcurrently(mkdtempSync(join(tmpdir(), 'no-arm-')))).toBe(
      false,
    )
    expect(baseWalksConcurrently(REPO_ROOT)).toBe(true)
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
    // What the ARMS read, not the log. stderr is printed from the refusals
    // before they are serialized, so a dropped reason or a wrong budget still
    // looked fine there.
    const arm = parseArmEnv(intoArmEnv(PARSE(written)))
    expect(arm.backgroundRefused?.get('opposition_research')).toMatch(
      /^would take 195 minutes/,
    )
    expect(arm.armBudgetMs).toBe(ARM_BUDGET_MS)
  })

  // THE SAME SELECTION, TWO ANSWERS, by how the base walks. Two agents of
  // three 15-minute runs: one after another that is 45 minutes each, and the
  // second does not fit what the first left; in one wave both are six runs
  // finishing together. So this is what proves the probe reaches the rule.
  it.each<[string, boolean, string]>([
    ['one run after another', false, 'opposition_research'],
    ['all at once', true, 'opposition_research,race_opponent_actions'],
  ])('admits by how the base arm walks: %s', (_label, concurrent, admitted) => {
    const { written, stderr } = runEntry({
      BASE_DIR: baseTree({
        concurrent,
        timeouts: { opposition_research: 600, race_opponent_actions: 600 },
      }),
      JUDGE_AGENTS: 'opposition_research,race_opponent_actions',
    })
    expect(written).toMatch(new RegExp(`^admitted=${admitted}$`, 'm'))
    expect(stderr).toMatch(
      concurrent
        ? /up to 12 runs at once/
        : /one run after another, as the base ref does/,
    )
  })

  // In a wave the slower arm still decides, per run: a base whose single run
  // is 80 minutes cannot finish inside a 70-minute arm, whatever is free.
  it('refuses a run the slower base cannot finish, in a wave', () => {
    const { written, stderr } = runEntry({
      BASE_DIR: baseTree({
        concurrent: true,
        timeouts: { opposition_research: 4500 },
      }),
      JUDGE_AGENTS: 'opposition_research',
    })
    expect(written).toMatch(/^admitted=$/m)
    expect(stderr).toMatch(
      /refused opposition_research: would take 80 minutes for a single run/,
    )
    expect(stderr).toMatch(/up to 12 runs at once/)
  })

  // Five agents of three runs against twelve slots: the fifth is refused and
  // says so, rather than being started and queued behind the platform's cap.
  it('fills the slots in walk order and refuses the rest by name', () => {
    const ids = [
      'opposition_research',
      'race_opponent_actions',
      'race_opponent_summary',
      'opportunities_and_challenges',
      'district_issue_pulse',
    ]
    const { written, stderr } = runEntry({
      BASE_DIR: baseTree({
        concurrent: true,
        timeouts: Object.fromEntries(ids.map((id) => [id, 600])),
      }),
      JUDGE_AGENTS: ids.join(','),
    })
    expect(written).toMatch(
      new RegExp(`^admitted=${ids.slice(0, 4).join(',')}$`, 'm'),
    )
    expect(stderr).toMatch(
      /refused district_issue_pulse: needs 3 runs in flight at once, and 0 of the arm's 12 slots/,
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
    expect(
      parseArmEnv(intoArmEnv(PARSE(written))).backgroundRefused?.get(
        'opposition_research',
      ),
    ).toMatch(/predates shared background admission/)
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
  // Both arms walking the same single case, so these tests isolate the cost;
  // the case-id check has its own test below.
  const walk = (runMs: number, runs = 1, caseIds = ['c1']) => ({
    runs,
    runMs,
    caseIds,
  })
  // Each agent its own case ids, so tests about something else are not
  // refused for sharing one.
  const own = (runMs: number) => (one: AgentEntry) =>
    walk(runMs, 1, [`${one.agentId}-c1`])

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
        candidate: () => walk(minutes(30)),
        base: () => walk(minutes(90)),
        honoursAdmission: () => true,
        walksConcurrently: () => false,
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
        candidate: () => walk(minutes(10)),
        base: () => undefined,
        honoursAdmission: () => true,
        walksConcurrently: () => false,
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
          return walk(minutes(10))
        },
        base: () => walk(minutes(10)),
        honoursAdmission: () => true,
        walksConcurrently: () => false,
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
        candidate: () => walk(minutes(10)),
        base: () => walk(minutes(10)),
        honoursAdmission: () => true,
        walksConcurrently: () => false,
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
        candidate: own(minutes(30)),
        base: (_dir, one) => own(minutes(30))(one),
        honoursAdmission: () => true,
        walksConcurrently: () => false,
      },
    )
    expect(result.admitted).toEqual(['a', 'b'])
  })

  // TWO AGENTS, ONE CASE ID. A base arm that walks one run after another
  // predates run ids that name the agent, so both would dispatch the same id
  // and the platform would drop the second: refused there, by name. A base
  // that walks concurrently names the agent, so both are admitted.
  it.each<[string, boolean, string[]]>([
    ['refuses the second against a sequential base', false, ['a']],
    ['admits both against a concurrent base', true, ['a', 'b']],
  ])('with a shared case id, %s', (_label, concurrent, admitted) => {
    const result = resolveAdmission(
      ['a', 'b'],
      '/base',
      DEFAULT_JUDGE_CONFIG,
      registry,
      {
        candidate: () => walk(minutes(10), 1, ['shared', 'x']),
        base: () => walk(minutes(10), 1, ['shared', 'x']),
        honoursAdmission: () => true,
        walksConcurrently: () => concurrent,
      },
    )
    expect(result.admitted).toEqual(admitted)
    if (!concurrent) {
      expect(result.refused[0]?.reason).toMatch(
        /shares case ids \[shared, x\] with an agent already admitted/,
      )
    }
  })

  // ATTEMPTS ON THE BASE SIDE. At 1 attempt, dropping attempts from the base
  // cost changed nothing; at 2 it is the whole difference between 45 minutes
  // that fit and 90 that do not.
  it('multiplies the base arm by attempts too', () => {
    const config = {
      ...DEFAULT_JUDGE_CONFIG,
      background: { attemptsPerCase: 2, maxCases: 1, maxInFlight: 12 },
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
  // find_existing_ordinances is 110 minutes and refused; at 1 it would be 55
  // and wrongly admitted to an arm it then overruns.
  it('multiplies the candidate arm by attempts when the candidate is slower', () => {
    const config = {
      ...DEFAULT_JUDGE_CONFIG,
      background: { attemptsPerCase: 2, maxCases: 1, maxInFlight: 12 },
    }
    const result = resolveAdmission(
      ['find_existing_ordinances'],
      baseTree({ timeouts: { find_existing_ordinances: 60 } }),
      config,
    )
    expect(result.admitted).toEqual([])
    expect(result.refused[0]?.reason).toMatch(/would take 110 minutes/)
  })

  // THE SAME CASES OR NOTHING. A branch that inserts a case near the top of a
  // list has each arm take a different first three, and the runs only one arm
  // walks are paid for and pair with nothing. Built from the REAL list, so the
  // ids the candidate will actually walk are the ones the base disagrees with.
  it('refuses an agent whose two arms would walk different cases', () => {
    const real = JSON.parse(
      readFileSync(
        join(__dirname, 'cases', 'opposition_research.json'),
        'utf8',
      ),
    ) as { cases: { caseId: string }[] }
    const first = real.cases.map((one) => one.caseId)
    const result = resolveAdmission(
      ['opposition_research'],
      baseTree({
        timeouts: { opposition_research: 600 },
        caseIds: {
          opposition_research: ['inserted-at-top', ...first.slice(0, 2)],
        },
      }),
    )
    expect(result.admitted).toEqual([])
    expect(result.refused[0]?.reason).toMatch(
      /would walk different cases on the two arms/,
    )
    expect(result.refused[0]?.reason).toContain('inserted-at-top')
    expect(result.refused[0]?.reason).toContain(first[2])
  })

  it('refuses an agent whose base list repeats a case id', () => {
    const result = resolveAdmission(
      ['opposition_research'],
      baseTree({
        timeouts: { opposition_research: 600 },
        caseIds: {
          opposition_research: [
            'baseline-three-way-nonpartisan',
            'head-to-head',
            'head-to-head',
          ],
        },
      }),
    )
    expect(result.refused[0]?.reason).toMatch(
      /repeated case id on the base arm/,
    )
  })

  // Same ids in another order still pair, so they are not refused.
  it('admits an agent whose two arms walk the same cases in a different order', () => {
    const real = JSON.parse(
      readFileSync(
        join(__dirname, 'cases', 'opposition_research.json'),
        'utf8',
      ),
    ) as { cases: { caseId: string }[] }
    const first = real.cases.slice(0, 3).map((one) => one.caseId)
    const result = resolveAdmission(
      ['opposition_research'],
      baseTree({
        timeouts: { opposition_research: 600 },
        caseIds: { opposition_research: [...first].reverse() },
      }),
    )
    expect(result.admitted).toEqual(['opposition_research'])
  })

  // A BASE THAT WILL NOT OBEY. Its arm ignores the admitted list and walks
  // every background agent at its own old budget, refusing each one; the
  // candidate would run them, and that is paid work pairing with nothing. So nothing is admitted and every one says why.
  it('admits nothing when the base ref predates shared admission', () => {
    // A chat agent among them: it never had a background budget to lose, so
    // listing it as refused would only put noise in the report.
    const withChat = [...registry, { ...agent('talk'), shape: 'chat' as const }]
    const result = resolveAdmission(
      ['a', 'talk', 'b'],
      '/base',
      DEFAULT_JUDGE_CONFIG,
      withChat,
      {
        candidate: () => walk(minutes(1)),
        base: () => walk(minutes(1)),
        honoursAdmission: () => false,
        walksConcurrently: () => false,
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
    // Two runs an agent against five slots admits two agents; dropping the
    // attempts on either path makes it one run each, and admits five.
    const config = {
      ...DEFAULT_JUDGE_CONFIG,
      background: { attemptsPerCase: 2, maxCases: 1, maxInFlight: 5 },
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
    expect(resolved).toEqual(['campaign_tracker_tasks', 'district_issue_pulse'])
  })
})

// The module-scope read of the arm budget, which vitest needs before any test
// body runs. It used a looser parse than parseArmEnv once, so "1e7" passed it
// and failed there — two reads of one value disagreeing.
describe('armTimeoutMs', () => {
  const swept = (budget: string | undefined): NodeJS.ProcessEnv => ({
    JUDGE_BACKGROUND_ATTEMPTS: '1',
    ...(budget !== undefined && { JUDGE_ARM_BUDGET_MS: budget }),
  })

  it('reads the resolved budget', () => {
    expect(armTimeoutMs(swept('4860000'), 70)).toBe(4_860_000)
  })

  it.each([undefined, '', '  '])(
    'falls back to the arm constant for %j',
    (raw) => {
      expect(armTimeoutMs(swept(raw), 70)).toBe(70)
    },
  )

  // The same mode switch parseArmEnv applies. Honouring the budget without
  // ATTEMPTS gave a local run this timeout while its loader spent the arm
  // constant, and it was killed partway through.
  it('ignores a budget that arrives without the rest of the sweep inputs', () => {
    expect(armTimeoutMs({ JUDGE_ARM_BUDGET_MS: '600000' }, 70)).toBe(70)
  })

  it.each(['1e7', '1.5', '0', '-1', 'x'])(
    'refuses %j as parseArmEnv does',
    (raw) => {
      expect(() => armTimeoutMs(swept(raw), 70)).toThrow(SweepEnvError)
    },
  )
})

describe('reading the budget an arm was handed', () => {
  // No input means a local run: the arm's own config, and no admitted set, so
  // the arm decides admission itself.
  it('leaves the arm on its own config when nothing was resolved', () => {
    const base = configWith({ attemptsPerCase: 7, maxCases: 9 })
    const arm = parseArmEnv(armEnvFor())
    expect(arm.backgroundBudget).toBeUndefined()
    expect(arm.backgroundAdmitted).toBeUndefined()
    expect(arm.backgroundRefused).toBeUndefined()
    expect(arm.armBudgetMs).toBeUndefined()
    // An explicit, non-default base: compared against the default, "uses
    // base" and "ignores base" could not be told apart.
    expect(armConfigFor(arm, base)).toBe(base)
  })

  // Only `background` is replaced. A wholesale swap would also reset the
  // chat attempts and the gates to whatever the arm's checkout says.
  it('replaces the background budget and nothing else', () => {
    // Non-default slots, so keeping the BASE's slots is told apart from
    // keeping the default's.
    const base = {
      ...DEFAULT_JUDGE_CONFIG,
      attemptsPerCase: 6,
      background: { attemptsPerCase: 7, maxInFlight: 5 },
    }
    const arm = parseArmEnv(
      armEnvFor({
        JUDGE_BACKGROUND_ATTEMPTS: '2',
        JUDGE_BACKGROUND_MAX_CASES: '5',
      }),
    )
    const config = armConfigFor(arm, base)
    // The slots stay the arm's own: they never travel, and on a sweep the
    // admitted list already says what runs.
    expect(config.background).toEqual({
      attemptsPerCase: 2,
      maxCases: 5,
      maxInFlight: 5,
    })
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

  // A refusal list that is not what the resolver writes is refused, not read
  // as "no reasons" — which would put "see the step log" back in the report.
  it.each(['not json', '["a"]', '{"a":1}', 'null'])(
    'refuses %j as a refusal list',
    (raw) => {
      expect(() =>
        parseArmEnv(
          armEnvFor({
            JUDGE_BACKGROUND_ATTEMPTS: '1',
            JUDGE_BACKGROUND_REFUSED: raw,
          }),
        ),
      ).toThrow(SweepEnvError)
    },
  )

  it.each(['0', '-1', '1.5', '1e7', 'three', '3x'])(
    'refuses %j as an arm budget',
    (raw) => {
      expect(() =>
        parseArmEnv(
          armEnvFor({
            JUDGE_BACKGROUND_ATTEMPTS: '1',
            JUDGE_ARM_BUDGET_MS: raw,
          }),
        ),
      ).toThrow(/milliseconds/)
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

// THE CHAT HALF, decided once like the background half: each arm reads its
// own case lists, and two arms refusing different chat agents pay for turns
// that pair with nothing.
describe('the chat agents refused for time', () => {
  const ALL_CHAT =
    'chief_of_staff,campaign_assistant,ordinance_flow,priority_flow'
  const chatTree = (over: Parameters<typeof baseTree>[0] = { timeouts: {} }) =>
    baseTree({
      boundsChat: true,
      chatCases: {
        chief_of_staff: 8,
        campaign_assistant: 8,
        ordinance_flow: 8,
        priority_flow: 8,
      },
      ...over,
    })

  // Every chat agent at today's lists: 8 + 48 minutes fit the 65 the arm
  // leaves chat, and the two after are refused by name. Read back through the
  // arm's own loader, so the resolver is tied to what the arm refuses.
  it('refuses what does not fit, and both arms refuse exactly that', () => {
    const { status, stderr, written } = runEntry({
      BASE_DIR: chatTree(),
      JUDGE_AGENTS: ALL_CHAT,
    })
    expect(status).toBe(0)
    expect(stderr).toMatch(
      /refused ordinance_flow: would take about 48 minutes for 24 chat turns/,
    )
    const arm = parseArmEnv(intoArmEnv(PARSE(written)))
    expect([...(arm.backgroundRefused?.keys() ?? [])]).toEqual([
      'ordinance_flow',
      'priority_flow',
    ])
    const { loadCases } = armDeps(arm, armConfigFor(arm))
    const agent = (id: string): AgentEntry => {
      const found = findAgent(id)
      if (found === undefined) throw new Error(`${id} is not registered`)
      return found
    }
    expect(() => loadCases(agent('ordinance_flow'))).toThrow(
      /^ordinance_flow was not admitted to this sweep: would take about 48/,
    )
    expect(loadCases(agent('campaign_assistant')).cases).toHaveLength(8)
    expect(capturableAgents(ALL_CHAT.split(','), arm, findAgent)).toEqual([
      'chief_of_staff',
      'campaign_assistant',
    ])
  })

  // Against a base that would walk them anyway, refusing on the candidate
  // only pays the base for turns that pair with nothing.
  it('refuses no chat agent against a base that would not obey', () => {
    const { written, stderr } = runEntry({
      BASE_DIR: chatTree({ timeouts: {}, boundsChat: false }),
      JUDGE_AGENTS: ALL_CHAT,
    })
    expect(written).toMatch(/^refused=\{\}$/m)
    expect(stderr).toMatch(/does not refuse chat agents/)
  })

  // The slower arm decides, as it does for background.
  it('costs an agent on whichever arm has more cases', () => {
    const { written } = runEntry({
      BASE_DIR: chatTree({ timeouts: {}, chatCases: { chief_of_staff: 200 } }),
      JUDGE_AGENTS: 'chief_of_staff',
    })
    expect(
      parseArmEnv(intoArmEnv(PARSE(written))).backgroundRefused?.get(
        'chief_of_staff',
      ),
    ).toMatch(/^would take about 200 minutes for 600 chat turns/)
  })
})

describe('the probe for whether the base arm refuses chat agents', () => {
  it('finds the declaration in this branch', () => {
    expect(
      BASE_BOUNDS_CHAT.test(
        readFileSync(join(__dirname, 'runners/backgroundDispatch.ts'), 'utf8'),
      ),
    ).toBe(true)
  })

  it.each([
    ['the name in a comment', '// CHAT_TIME_BOUNDED is not declared here\n'],
    [
      'a declaration that says false',
      'export const CHAT_TIME_BOUNDED = false\n',
    ],
  ])('does not mistake %s for an arm that does', (_label, text) => {
    expect(BASE_BOUNDS_CHAT.test(text)).toBe(false)
  })
})

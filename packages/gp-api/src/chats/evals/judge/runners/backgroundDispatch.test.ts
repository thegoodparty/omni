import { describe, expect, it } from 'vitest'
import {
  ARM_BUDGET_MS,
  POLL_HEADROOM_MS,
  admitBackground,
  armDeps,
  backgroundRunInputFor,
  caseLoaderFor,
  refusedBeforeSpend,
} from './backgroundDispatch'
import { DEFAULT_JUDGE_CONFIG } from '../config'
import { findAgent } from '../agents'
import { SWEEP_VALUES } from '../fixtures/sweep'
import type { AgentConfig } from './background'
import type { ArmCaseRequest } from '../sweepArm'
import type { ArmEnv } from '../sweepEnv'
import type { BackgroundCase, CaseList, JudgeCase } from '../cases'

// WHAT THIS FILE IS FOR. Every argument of the dispatch used to be built
// inline inside `sweep.eval.test.ts`, a suite that only executes when
// JUDGE_ARM is set — so in CI it was dead text. Two deliberate mis-wirings
// proved the gap: swapping metadataBucket for artifactBucket, and hardcoding
// one agent id in place of request.agent.agentId. Both typecheck. Both
// survived the entire suite. One `toEqual` over the whole returned object is
// what closes that, so prefer extending the fixture below over adding a test
// that reaches for a single field.

const config = (over: Record<string, unknown> = {}): AgentConfig => ({
  manifest: JSON.stringify({
    model: 'sonnet',
    max_turns: 40,
    timeout_seconds: 1800,
    output_schema: { type: 'object' },
    ...over,
  }),
  instruction: 'do the research',
})

// DELIBERATELY DISAGREES WITH `request()` ON EVERY FIELD BOTH CARRY.
//
// sweepId and arm exist on both, and `parseArmEnv` does not reconcile them.
// While the two fixtures said the same thing, reading either field off the
// wrong one was invisible: mutations substituting `env.sweepId` for
// `request.sweepId`, and `env.arm` for `request.arm`, both survived the whole
// suite. Records written under the wrong sweep id land in a directory the
// other arm never looks in.
//
// Keep them different. The whole-object assertion below then covers every
// field's SOURCE for free, which is cheaper than a test per field.
const env = (over: Partial<ArmEnv> = {}): ArmEnv => ({
  sweepId: 'sweep-from-env',
  agentIds: ['meeting_briefing'],
  spends: true,
  explicitSelection: false,
  recordsDir: '/tmp/records',
  arm: 'base',
  baseRef: 'main',
  candidateSha: 'c0ffee',
  armCommit: 'deadbeef',
  fixtureValues: { orgSlug: 'judge-fixture-1' },
  metadataBucket: 'agent-experiment-metadata-dev',
  artifactBucket: 'gp-agent-artifacts-dev',
  dispatchQueueUrl:
    'https://sqs.us-west-2.amazonaws.com/1/agent-dispatch-dev.fifo',
  ...over,
})

const request = (over: Partial<ArmCaseRequest> = {}): ArmCaseRequest => ({
  agent: {
    agentId: 'meeting_briefing',
    shape: 'background',
    cases: 'meeting_briefing',
    status: 'wired',
  },
  case: { caseId: 'case-1', params: { meeting_id: 'm-1' } },
  attempt: 2,
  sweepId: 'sweep-from-request',
  arm: 'candidate',
  variant: { ref: 'feature', commit: 'deadbeef' },
  spends: true,
  ...over,
})

describe('backgroundRunInputFor', () => {
  // THE ASSERTION THAT MATTERS. Whole-object, so a field wired to the wrong
  // source fails here rather than at a cost nobody notices.
  it('builds every argument of the dispatch from the request and the env', () => {
    const built = config()
    expect(backgroundRunInputFor(request(), env(), () => built)).toEqual({
      sweepId: 'sweep-from-request',
      agentId: 'meeting_briefing',
      arm: 'candidate',
      attempt: 2,
      agentCase: { caseId: 'case-1', params: { meeting_id: 'm-1' } },
      config: built,
      variant: { ref: 'feature', commit: 'deadbeef', model: 'sonnet' },
      organizationSlug: 'judge-fixture-1',
      metadataBucket: 'agent-experiment-metadata-dev',
      artifactBucket: 'gp-agent-artifacts-dev',
      poll: {
        timeoutMs: 1800 * 1000 + POLL_HEADROOM_MS,
        intervalMs: 10 * 1000,
      },
    })
  })

  // The config is loaded for the agent the request names. Hardcoding an id
  // here would judge one agent's branch against another agent's behaviour.
  //
  // ASKS FOR AN AGENT THE FIXTURE DOES NOT DEFAULT TO, which is the whole
  // reason this test can see anything: written against the default agent it
  // passed happily while the function ignored the request entirely and loaded
  // one id of its own.
  it('loads the config for the agent the request names', () => {
    const asked: string[] = []
    backgroundRunInputFor(
      request({
        agent: {
          agentId: 'self_research',
          shape: 'background',
          cases: 'self_research',
          status: 'wired',
        },
      }),
      env(),
      (agentId) => {
        asked.push(agentId)
        return config()
      },
    )
    expect(asked).toEqual(['self_research'])
  })

  // THE RETURNED FIELD, not just the loader call. The test above hands a
  // non-default agent to `loadConfig` and checks what it was asked for; this
  // checks what came back carries the same id. A literal here would judge one
  // agent's branch against another agent's records — the failure the file's
  // header names — and it survived until this assertion existed, because the
  // whole-object test's fixture agent IS the id a hardcode would pick.
  it('carries that agent id into the dispatch', () => {
    const built = backgroundRunInputFor(
      request({
        agent: {
          agentId: 'self_research',
          shape: 'background',
          cases: 'self_research',
          status: 'wired',
        },
      }),
      env(),
      () => config(),
    )
    expect(built.agentId).toBe('self_research')
  })

  // WHY THE POLL IS DERIVED AND NOT A CONSTANT. A flat 15 minutes was shorter
  // than eleven of the sixteen published agents' own `timeout_seconds`, so a
  // perfectly healthy run was abandoned inside its own budget: the money was
  // already spent, the Fargate task kept going, and the record came back an
  // infraError that the delta excludes. Both arms, every attempt.
  // PINNED TO A LITERAL, because every other assertion about the headroom
  // computes its expectation FROM the constant and so cannot constrain it:
  // shrinking it to 30 seconds passed the entire suite. This is the one
  // number deciding whether a healthy run is abandoned inside its own
  // declared timeout, billed, and then excluded from the delta.
  it('allows five minutes for task placement and artifact upload', () => {
    expect(POLL_HEADROOM_MS).toBe(5 * 60 * 1000)
  })

  it.each([
    [1200, 1_500_000],
    [3600, 3_900_000],
  ])('waits out an agent declaring %i seconds', (seconds, expected) => {
    const input = backgroundRunInputFor(request(), env(), () =>
      config({ timeout_seconds: seconds }),
    )
    expect(input.poll.timeoutMs).toBe(expected)
  })

  it('refuses a manifest with no usable timeout rather than guessing one', () => {
    expect(() =>
      backgroundRunInputFor(request(), env(), () =>
        config({ timeout_seconds: 0 }),
      ),
    ).toThrow(/not a budget/)
  })

  // The model reaches the record, and the record is what the cost delta is
  // priced from. A literal here would disagree with the manifest the override
  // stages and misattribute the cost.
  it('takes the model from the manifest it is about to stage', () => {
    const input = backgroundRunInputFor(request(), env(), () =>
      config({ model: 'claude-fable-5' }),
    )
    expect(input.variant.model).toBe('claude-fable-5')
  })

  it('passes the data version through only when the sweep pinned one', () => {
    expect(
      backgroundRunInputFor(request(), env(), () => config()),
    ).not.toHaveProperty('dataVersion')
    expect(
      backgroundRunInputFor(request(), env({ dataVersion: '42' }), () =>
        config(),
      ).dataVersion,
    ).toBe('42')
  })

  // REFUSED BY NAME, BEFORE ANYTHING IS STAGED OR SENT. The dispatch builder
  // enforces the `judge-` prefix itself, but its message is about a slug it
  // was handed. This one is about the sweep never having minted a fixture,
  // which is the actual fault, and it names the variable that fixes it.
  it('refuses when the sweep minted no fixture organization', () => {
    expect(() =>
      backgroundRunInputFor(request(), env({ fixtureValues: {} }), () =>
        config(),
      ),
    ).toThrow(/JUDGE_FIXTURE_ORG_SLUG/)
  })

  it('refuses a chat case handed to the background path', () => {
    expect(() =>
      backgroundRunInputFor(
        request({ case: { caseId: 'chat-1', turns: ['hello'] } }),
        env(),
        () => config(),
      ),
    ).toThrow(/chat case/)
  })

  // Names every missing variable at once rather than the first, which is what
  // backgroundDestinationFrom exists for — and it is reached from here, which
  // is the only path that actually needs it.
  it('refuses a half-configured destination, naming all of it', () => {
    expect(() =>
      backgroundRunInputFor(
        request(),
        env({ artifactBucket: undefined, dispatchQueueUrl: undefined }),
        () => config(),
      ),
    ).toThrow(/JUDGE_ARTIFACT_BUCKET[\s\S]*JUDGE_DISPATCH_QUEUE_URL/)
  })
})

const HUGE_BUDGET_MS = 1000 * 60 * 60 * 1000

const caseList = (
  shape: 'background' | 'chat',
  agentId: string,
  cases: JudgeCase[],
): CaseList => ({
  agentId,
  shape,
  placeholder: false,
  cases,
  source: `${agentId}.json`,
})

describe('caseLoaderFor', () => {
  const agent = {
    agentId: 'top_community_issues',
    shape: 'background' as const,
    cases: 'top_community_issues',
    status: 'wired' as const,
  }
  const chat = { ...agent, agentId: 'chief_of_staff', shape: 'chat' as const }
  const withToken: BackgroundCase[] = [
    { caseId: 'c1', params: { organization_slug: '{judgeOrgSlug}' } },
  ]

  // THE BUG THIS EXISTS FOR. Nothing called substituteBackgroundCases, so six
  // of the fifteen background lists reached the dispatch builder with their
  // tokens intact and were refused one by one as named skips — reading as bad
  // case lists rather than as missing wiring.
  it('substitutes a background list before it is walked', () => {
    // The envelope reader returns a DECOY list. Only `loadBackground`'s cases
    // may reach the output: substituting `list.cases` instead of re-reading
    // is a mutation that survived while both seams returned the same array.
    const decoy: BackgroundCase[] = [{ caseId: 'decoy', params: {} }]
    const list = caseLoaderFor(
      { orgSlug: 'judge-fixture-1' },
      { budgetMs: HUGE_BUDGET_MS, attemptsPerCase: 3, maxCases: undefined },
      {
        load: () => caseList('background', agent.agentId, decoy),
        loadBackground: () => withToken,
        loadConfig: () => config(),
      },
    )(agent)
    expect(list.cases).toEqual([
      { caseId: 'c1', params: { organization_slug: 'judge-fixture-1' } },
    ])
  })

  // Checked over the whole list up front, not case by case: the alternative
  // pays for cases 1-7 and dies on case 8.
  it('refuses the whole list when one case cannot be substituted', () => {
    const mixed: BackgroundCase[] = [
      { caseId: 'c1', params: { organization_slug: '{judgeOrgSlug}' } },
      { caseId: 'c8', params: { race_id: '{judgeRaceId}' } },
    ]
    expect(() =>
      caseLoaderFor(
        { orgSlug: 'judge-fixture-1' },
        { budgetMs: HUGE_BUDGET_MS, attemptsPerCase: 3, maxCases: undefined },
        {
          load: () => caseList('background', agent.agentId, mixed),
          loadBackground: () => mixed,
          loadConfig: () => config(),
        },
      )(agent),
    ).toThrow(/c8/)
  })

  it('leaves a chat list alone', () => {
    const cases = [{ caseId: 'c1', turns: ['hello'] }]
    const list = caseLoaderFor(
      { orgSlug: 'judge-fixture-1' },
      { budgetMs: HUGE_BUDGET_MS, attemptsPerCase: 3, maxCases: undefined },
      { load: () => caseList('chat', chat.agentId, cases) },
    )(chat)
    expect(list.cases).toEqual(cases)
  })
})

// THE REFUSAL, AND WHERE IT IS THROWN FROM.
//
// An earlier version checked the whole selection at the top of the arm. Every
// background agent overruns any plausible budget on its own — six hours at
// the cheapest — so that fired on every selection naming one and took the
// CHAT agents down with it, which is strictly worse than the unwired state it
// replaced. These tests pin the placement, not just the arithmetic.
describe('the wall-clock refusal', () => {
  const background = {
    agentId: 'meeting_briefing',
    shape: 'background' as const,
    cases: 'meeting_briefing',
    status: 'wired' as const,
  }
  const chat = {
    agentId: 'chief_of_staff',
    shape: 'chat' as const,
    cases: 'chief_of_staff',
    status: 'wired' as const,
  }
  const eight: BackgroundCase[] = Array.from({ length: 8 }, (_, i) => ({
    caseId: `c${i}`,
    params: {},
  }))
  const loader = (
    budgetMs: number,
    maxCases?: number,
    attempts = 3,
    admitted?: ReadonlySet<string>,
  ) =>
    caseLoaderFor(
      {},
      {
        budgetMs,
        attemptsPerCase: attempts,
        maxCases,
        ...(admitted !== undefined && { admitted }),
      },
      {
        load: (agent) =>
          agent.shape === 'background'
            ? caseList('background', agent.agentId, eight)
            : caseList('chat', agent.agentId, [
                { caseId: 'c1', turns: ['hi'] },
              ]),
        loadBackground: () => eight,
        // meeting_briefing declares an hour; opposition_research ten minutes.
        loadConfig: (agentId) =>
          config({
            timeout_seconds: agentId === 'meeting_briefing' ? 3600 : 600,
          }),
      },
    )

  // cases x attempts x the agent's own poll: 8 x 3 x 65 minutes.
  it('names the agent, what it costs, and what is left', () => {
    expect(() => loader(70 * 60 * 1000)(background)).toThrow(
      /meeting_briefing would take 1560 minutes[\s\S]*70 of its 70 left/,
    )
  })

  // THE RUNNING TOTAL, which is what the per-agent check alone cannot see.
  // captureArm walks agents sequentially, so four agents that each fit the
  // arm can still take three times it between them. The second call has to
  // be refused against what the first one left, and the message has to say
  // how much was already committed or the number reads as a contradiction.
  it('spends the budget down across agents', () => {
    // One case at one attempt is 65 minutes, so the first agent fits a
    // 100-minute arm and the second cannot.
    const load = loader(100 * 60 * 1000, 1, 1)
    expect(() => load(background)).not.toThrow()
    expect(() => load(background)).toThrow(
      /35 of its 100 left.*already committed/s,
    )
  })

  // THE REGRESSION THIS REPLACED. A chat agent in the same selection must
  // still load, so captureArm still captures it and the sweep still produces
  // a verdict for the half that can.
  it('leaves a chat agent in the same sweep untouched', () => {
    expect(() => loader(70 * 60 * 1000)(chat)).not.toThrow()
  })

  it('allows an agent that fits', () => {
    expect(() => loader(HUGE_BUDGET_MS)(background)).not.toThrow()
  })

  // THE CAP IS WHAT MAKES THE AGENT FIT, so it has to be applied before the
  // budget is measured. Measured against the file instead, the refusal fires
  // on a list the sweep was never going to walk.
  it('measures the budget against the capped list, not the file', () => {
    // 8 cases x 3 attempts x 65m is far over; 1 x 3 x 65m is not.
    expect(() => loader(200 * 60 * 1000)(background)).toThrow()
    expect(() => loader(200 * 60 * 1000, 1)(background)).not.toThrow()
  })

  // The first n, not a sample. Two arms that walked different cases have
  // nothing to pair, and both arms read this from one config.
  it('takes the first n cases so both arms walk the same ones', () => {
    const list = loader(HUGE_BUDGET_MS, 3)(background)
    expect(list.cases.map((one) => one.caseId)).toEqual(['c0', 'c1', 'c2'])
  })

  it('walks the whole list when no cap is set', () => {
    expect(loader(HUGE_BUDGET_MS, undefined)(background).cases).toHaveLength(8)
  })
})

describe('the budget guards and the sweep-wide admission', () => {
  const background = {
    agentId: 'meeting_briefing',
    shape: 'background' as const,
    cases: 'meeting_briefing',
    status: 'wired' as const,
  }
  const cheap = { ...background, agentId: 'opposition_research' }
  const chat = {
    ...background,
    agentId: 'chief_of_staff',
    shape: 'chat' as const,
  }
  const eight: BackgroundCase[] = Array.from({ length: 8 }, (_, i) => ({
    caseId: `c${i}`,
    params: {},
  }))
  const deps = {
    load: (agent: AgentEntryLike) =>
      agent.shape === 'background'
        ? caseList('background', agent.agentId, eight)
        : caseList('chat', agent.agentId, [{ caseId: 'c1', turns: ['hi'] }]),
    loadBackground: () => eight,
    loadConfig: (agentId: string) =>
      config({ timeout_seconds: agentId === 'meeting_briefing' ? 3600 : 600 }),
  }
  type AgentEntryLike = { agentId: string; shape: 'chat' | 'background' }

  // A REFUSED AGENT LEAVES ITS SHARE. captureArm walks every selected agent,
  // refused ones included, so a refusal that still deducted would starve
  // every agent after it of budget it never used.
  it('does not charge a refused agent against the agents after it', () => {
    // 100 minutes. meeting_briefing at 1 case x 1 attempt is 65 — over, once
    // the cap makes it 3 cases (195). opposition_research is 15 a case.
    const load = caseLoaderFor(
      {},
      { budgetMs: 100 * 60 * 1000, attemptsPerCase: 1, maxCases: 3 },
      deps,
    )
    expect(() => load(background)).toThrow(/would take 195 minutes/)
    expect(() => load(cheap)).not.toThrow()
  })

  // 0 judges nothing while reporting a clean arm; -1 is read by slice as
  // "all but the last". Refused when the loader is BUILT, before any agent.
  it.each([0, -1])('refuses a case cap of %i', (maxCases) => {
    expect(() =>
      caseLoaderFor(
        {},
        { budgetMs: HUGE_BUDGET_MS, attemptsPerCase: 1, maxCases },
        deps,
      ),
    ).toThrow(/not a number of cases a sweep can walk/)
  })

  // ON A SWEEP, THE ADMITTED SET DECIDES, NOT THIS ARM'S OWN ARITHMETIC. Each
  // arm reads timeouts from its own worktree, so two arms deciding for
  // themselves disagree whenever a branch changes one.
  it('walks an admitted agent without re-deciding its budget', () => {
    // 3 cases x 1 attempt x 65 minutes is far over 1 ms — and admitted anyway,
    // because the decision was taken once, for both arms, elsewhere.
    const load = caseLoaderFor(
      {},
      {
        budgetMs: 1,
        attemptsPerCase: 1,
        maxCases: 3,
        admitted: new Set(['meeting_briefing']),
      },
      deps,
    )
    expect(load(background).cases).toHaveLength(3)
  })

  it('refuses an agent the sweep did not admit, however cheap', () => {
    const load = caseLoaderFor(
      {},
      {
        budgetMs: HUGE_BUDGET_MS,
        attemptsPerCase: 1,
        maxCases: 3,
        admitted: new Set(['meeting_briefing']),
      },
      deps,
    )
    expect(() => load(cheap)).toThrow(/not admitted to this sweep/)
  })

  // THE RESOLVER'S REASON, not a pointer at the step log. The refusal is what
  // the report shows, and "see the step" is a reason nobody reading a PR
  // comment can act on.
  it('refuses with the reason the resolver gave', () => {
    const load = caseLoaderFor(
      {},
      {
        budgetMs: HUGE_BUDGET_MS,
        attemptsPerCase: 1,
        maxCases: 3,
        admitted: new Set(),
        refusedReasons: new Map([
          ['opposition_research', 'would take 75 minutes on the slower arm'],
        ]),
      },
      deps,
    )
    expect(() => load(cheap)).toThrow(
      'opposition_research was not admitted to this sweep: would take 75 minutes on the slower arm',
    )
  })

  // BEFORE ANYTHING ELSE IS READ. Checked after substitution, an agent that
  // was never going to run surfaced as an unsubstituted-placeholder error,
  // and the report named the wrong cause.
  it('refuses as not admitted before it tries to substitute anything', () => {
    const withToken: BackgroundCase[] = [
      { caseId: 'c1', params: { race_id: '{judgeRaceId}' } },
    ]
    const load = caseLoaderFor(
      {},
      {
        budgetMs: HUGE_BUDGET_MS,
        attemptsPerCase: 1,
        maxCases: 3,
        admitted: new Set(),
      },
      { ...deps, loadBackground: () => withToken },
    )
    expect(() => load(cheap)).toThrow(/not admitted/)
  })

  // EMPTY IS NOT ABSENT. Nothing admitted means nothing walks — not "decide
  // for yourself", which is the per-arm decision this exists to replace.
  it('walks no background agent when the sweep admitted none', () => {
    const load = caseLoaderFor(
      {},
      {
        budgetMs: HUGE_BUDGET_MS,
        attemptsPerCase: 1,
        maxCases: 3,
        admitted: new Set(),
      },
      deps,
    )
    expect(() => load(cheap)).toThrow(/not admitted/)
    expect(() => load(chat)).not.toThrow()
  })
})

describe('admitBackground', () => {
  const agent = (
    agentId: string,
    shape: 'chat' | 'background' = 'background',
  ) => ({
    agentId,
    shape,
    cases: `${agentId}.json`,
    status: 'wired' as const,
  })
  const minutes = (n: number) => n * 60 * 1000

  // In walk order, spending one budget: the arms walk agents in this order
  // too, so an admission decided in any other order would disagree with what
  // the arms can actually afford.
  it('admits in walk order until the budget is spent', () => {
    const cost: Record<string, number> = {
      a: minutes(30),
      b: minutes(30),
      c: minutes(30),
    }
    const result = admitBackground(
      [agent('a'), agent('b'), agent('c')],
      (one) => ({ ms: cost[one.agentId] ?? 0 }),
      minutes(70),
    )
    expect(result.admitted).toEqual(['a', 'b'])
    expect(result.refused.map((one) => one.agentId)).toEqual(['c'])
    expect(result.refused[0]?.reason).toMatch(/10 of the arm's 70 were left/)
  })

  it('lets a later cheap agent through after an expensive one is refused', () => {
    const cost: Record<string, number> = {
      big: minutes(200),
      small: minutes(20),
    }
    const result = admitBackground(
      [agent('big'), agent('small')],
      (one) => ({ ms: cost[one.agentId] ?? 0 }),
      minutes(70),
    )
    expect(result.admitted).toEqual(['small'])
  })

  it('carries a refusal from the cost through, and skips chat agents', () => {
    const result = admitBackground(
      [agent('chief_of_staff', 'chat'), agent('new_one')],
      () => ({ refused: 'is not on the base ref' }),
      minutes(70),
    )
    expect(result.admitted).toEqual([])
    expect(result.refused).toEqual([
      { agentId: 'new_one', reason: 'is not on the base ref' },
    ])
  })
})

// THE ARM'S WIRING, which lived in a suite CI never runs. Two mistakes there
// passed everything: one loader per AGENT, giving each a fresh budget and
// undoing the spend-down; and `config` left off captureArm's deps, so the
// attempts fell back to the default while the cap used the resolved budget.
describe('armDeps', () => {
  const real = (agentId: string) => {
    const found = findAgent(agentId)
    if (found === undefined)
      throw new Error(`${agentId} is not in the registry`)
    return found
  }

  // A NON-DEFAULT budget, on both halves. At the default the loader could be
  // built from DEFAULT_JUDGE_CONFIG instead of `config` and behave the same,
  // so the cap of 1 is what proves the loader read the config it was handed.
  it('hands captureArm the same config the loader was built from', () => {
    const config = {
      ...DEFAULT_JUDGE_CONFIG,
      background: { attemptsPerCase: 1, maxCases: 1 },
    }
    const deps = armDeps(
      env({ fixtureValues: SWEEP_VALUES }),
      config,
      ARM_BUDGET_MS,
    )
    expect(deps.config).toBe(config)
    expect(deps.loadCases(real('opposition_research')).cases).toHaveLength(1)
  })

  // ONE loader for the arm, so the budget is spent across agents. Each of
  // these fits the 70-minute arm alone; the second does not fit after the
  // first, which only holds if both calls share one budget.
  it('spends one budget across every agent the arm walks', () => {
    const { loadCases } = armDeps(
      env({ fixtureValues: SWEEP_VALUES }),
      DEFAULT_JUDGE_CONFIG,
      ARM_BUDGET_MS,
    )
    expect(() => loadCases(real('opportunities_and_challenges'))).not.toThrow()
    expect(() => loadCases(real('opposition_research'))).toThrow(/would take/)
  })

  // THE SWEEP'S BUDGET, not this arm's constant. A 1 ms budget refuses an
  // agent that fits 70 minutes, which only happens if armDeps read the env.
  it('spends the budget the sweep resolved rather than its own constant', () => {
    const { loadCases } = armDeps(
      env({ fixtureValues: SWEEP_VALUES, armBudgetMs: 1 }),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(() => loadCases(real('opposition_research'))).toThrow(/would take/)
  })

  // And the resolver's reason, so the report says why.
  it('carries the sweep reasons through to the refusal', () => {
    const { loadCases } = armDeps(
      env({
        fixtureValues: SWEEP_VALUES,
        backgroundAdmitted: new Set(),
        backgroundRefused: new Map([
          [
            'opportunities_and_challenges',
            'would take 75 minutes on the slower arm',
          ],
        ]),
      }),
      DEFAULT_JUDGE_CONFIG,
    )
    expect(() => loadCases(real('opportunities_and_challenges'))).toThrow(
      'opportunities_and_challenges was not admitted to this sweep: would take 75 minutes on the slower arm',
    )
  })

  // On a sweep the admitted set decides, and armDeps is what carries it from
  // the env to the loader.
  it('passes the admitted set from the sweep through to the loader', () => {
    const { loadCases } = armDeps(
      env({
        fixtureValues: SWEEP_VALUES,
        backgroundAdmitted: new Set(['opposition_research']),
      }),
      DEFAULT_JUDGE_CONFIG,
      ARM_BUDGET_MS,
    )
    expect(() => loadCases(real('opposition_research'))).not.toThrow()
    expect(() => loadCases(real('opportunities_and_challenges'))).toThrow(
      /not admitted/,
    )
  })
})

// THE ARM SUITE'S RULE FOR A SKIP THAT IS NOT A FAILURE, held to the code that
// actually refuses. A predicate that drifted from the refusals would either
// turn a designed refusal red, which skips the candidate arm and strands every
// chat agent already paid for, or wave through a capture that broke.
describe('refusedBeforeSpend', () => {
  const background = request().agent
  const chat = {
    ...background,
    agentId: 'chief_of_staff',
    shape: 'chat' as const,
  }
  const one: BackgroundCase[] = [{ caseId: 'case-1', params: {} }]
  const loaderDeps = {
    load: () => caseList('background', background.agentId, one),
    loadBackground: () => one,
    loadConfig: () => config(),
  }
  // What the arm does with this env: load the agent's cases through the
  // loader the arm builds, then build the first dispatch. Either throwing is a
  // refusal before anything is staged.
  const armRefuses = (arm: ArmEnv): boolean => {
    try {
      const budget = {
        budgetMs: HUGE_BUDGET_MS,
        attemptsPerCase: 1,
        maxCases: undefined,
      }
      caseLoaderFor(
        arm.fixtureValues,
        arm.backgroundAdmitted === undefined
          ? budget
          : { ...budget, admitted: arm.backgroundAdmitted },
        loaderDeps,
      )(background)
      backgroundRunInputFor(request(), arm, () => config())
      return false
    } catch {
      return true
    }
  }

  it.each<[string, Partial<ArmEnv>]>([
    ['not admitted', { backgroundAdmitted: new Set(['someone_else']) }],
    ['admitted list empty', { backgroundAdmitted: new Set() }],
    ['no organization minted', { fixtureValues: {} }],
    ['no metadata bucket', { metadataBucket: undefined }],
    ['no artifact bucket', { artifactBucket: undefined }],
    ['no dispatch queue', { dispatchQueueUrl: undefined }],
  ])('counts %s as refused, and the arm does refuse it', (_, over) => {
    const arm = env(over)
    expect(armRefuses(arm)).toBe(true)
    expect(refusedBeforeSpend(background, arm)).toBe(true)
  })

  it.each<[string, Partial<ArmEnv>]>([
    [
      'admitted, with everything it needs',
      {
        backgroundAdmitted: new Set([background.agentId]),
      },
    ],
    ['a local run, which has no admitted list', {}],
  ])('does not count %s, and the arm does dispatch it', (_, over) => {
    const arm = env(over)
    expect(armRefuses(arm)).toBe(false)
    expect(refusedBeforeSpend(background, arm)).toBe(false)
  })

  // A chat agent needs none of it, so an env missing all of it refuses no
  // chat agent — and a chat skip stays the red job it should be.
  it('never counts a chat agent', () => {
    expect(
      refusedBeforeSpend(
        chat,
        env({
          backgroundAdmitted: new Set(),
          fixtureValues: {},
          metadataBucket: undefined,
          artifactBucket: undefined,
          dispatchQueueUrl: undefined,
        }),
      ),
    ).toBe(false)
  })
})

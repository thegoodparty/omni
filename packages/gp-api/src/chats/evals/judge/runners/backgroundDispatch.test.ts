import { describe, expect, it } from 'vitest'
import { JUDGE_FIXTURE } from '../judgeFixtureIdentity'
import {
  ARM_BUDGET_MS,
  CHAT_TURN_MS,
  POLL_HEADROOM_MS,
  UNMEASURED_CHAT_TURN_MS,
  WAVE_MARGIN_MS,
  admitBackground,
  armDeps,
  backgroundRunInputFor,
  caseLoaderFor,
  capturableAgents,
  chatBudgetMs,
  chatTurnMsFor,
  chatTurnsIn,
  refusedBeforeSpend,
  refuseChat,
  walkedBackgroundCases,
  withChatRefusals,
} from './backgroundDispatch'
import { DEFAULT_JUDGE_CONFIG } from '../config'
import { AGENTS, findAgent, type AgentEntry } from '../agents'
import { SWEEP_VALUES, armEnvFor } from '../fixtures/sweep'
import type { AgentConfig } from './background'
import type { ArmCaseRequest } from '../sweepArm'
import { parseArmEnv, type ArmEnv } from '../sweepEnv'
import { loadCaseList } from '../cases'
import type { BackgroundCase, CaseList, JudgeCase } from '../cases'

// WHAT THIS FILE IS FOR. Every argument of the dispatch used to be built
// inline inside the old vitest arm suite, which only executed when
// JUDGE_ARM was set — so in CI it was dead text. Two deliberate mis-wirings
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

  // OPT-IN PER AGENT. Only an entry the registry marks readsGpApi runs as the
  // fixture account; the whole-object test above is the agent that does not.
  it('dispatches a gp-api reader as the fixture account', () => {
    const built = config()
    const reader = request({
      agent: { ...request().agent, readsGpApi: true },
    })
    expect(backgroundRunInputFor(reader, env(), () => built)).toEqual({
      sweepId: 'sweep-from-request',
      agentId: 'meeting_briefing',
      arm: 'candidate',
      attempt: 2,
      agentCase: { caseId: 'case-1', params: { meeting_id: 'm-1' } },
      config: built,
      variant: { ref: 'feature', commit: 'deadbeef', model: 'sonnet' },
      organizationSlug: 'judge-fixture',
      clerkUserId: 'user_judge_fixture',
      metadataBucket: 'agent-experiment-metadata-dev',
      artifactBucket: 'gp-agent-artifacts-dev',
      poll: {
        timeoutMs: 1800 * 1000 + POLL_HEADROOM_MS,
        intervalMs: 10 * 1000,
      },
    })
  })

  // toEqual reads an undefined key as absent, so the whole-object test above
  // cannot tell "no user" from "a user key set to undefined".
  it('names no user for an agent that does not read gp-api', () => {
    const built = backgroundRunInputFor(request(), env(), () => config())
    expect(built).not.toHaveProperty('clerkUserId')
    expect(built.organizationSlug).toBe('judge-fixture-1')
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
  // was handed. This one is about the sweep never having resolved its
  // identifiers, which is the actual fault, and it names the step that fixes
  // it.
  it('refuses when the sweep resolved no identifiers', () => {
    expect(() =>
      backgroundRunInputFor(request(), env({ fixtureValues: {} }), () =>
        config(),
      ),
    ).toThrow(/resolved no judge identifiers[\s\S]*Resolve the background/)
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
      {
        budgetMs: HUGE_BUDGET_MS,
        attemptsPerCase: 3,
        maxCases: undefined,
        maxInFlight: 99,
      },
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

  // The params must name the organization the dispatch runs against, or the
  // artifact echoes one slug while the agent's reads used another.
  it("fills a gp-api reader's slug from the fixture, not the sweep", () => {
    const reader = { ...agent, readsGpApi: true as const }
    const list = caseLoaderFor(
      { orgSlug: 'judge-fixture-1' },
      {
        budgetMs: HUGE_BUDGET_MS,
        attemptsPerCase: 3,
        maxCases: undefined,
        maxInFlight: 99,
      },
      {
        load: () => caseList('background', reader.agentId, withToken),
        loadBackground: () => withToken,
        loadConfig: () => config(),
      },
    )(reader)
    expect(list.cases).toEqual([
      { caseId: 'c1', params: { organization_slug: 'judge-fixture' } },
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
        {
          budgetMs: HUGE_BUDGET_MS,
          attemptsPerCase: 3,
          maxCases: undefined,
          maxInFlight: 99,
        },
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
      {
        budgetMs: HUGE_BUDGET_MS,
        attemptsPerCase: 3,
        maxCases: undefined,
        maxInFlight: 99,
      },
      { load: () => caseList('chat', chat.agentId, cases) },
    )(chat)
    expect(list.cases).toEqual(cases)
  })
})

// THE REFUSAL, AND WHERE IT IS THROWN FROM.
//
// An earlier version checked the whole selection at the top of the arm. Every
// background agent overran any plausible budget on its own at the time, so
// that fired on every selection naming one and took the CHAT agents down with
// it, which is strictly worse than the unwired state it replaced. These tests
// pin the placement, not just the arithmetic.
//
// A local run's own refusal, by the wave: the arm starts every run at once,
// so an agent fits when one run fits the arm and its runs fit the slots left.
describe('the wave refusal', () => {
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
    maxInFlight = 12,
  ) =>
    caseLoaderFor(
      {},
      { budgetMs, attemptsPerCase: attempts, maxCases, maxInFlight },
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

  // One run is the agent's timeout plus the poll headroom: 60 + 5 minutes.
  it('refuses an agent whose single run outlasts the arm', () => {
    expect(() => loader(60 * 60 * 1000, 1, 1)(background)).toThrow(
      /meeting_briefing would take 65 minutes for a single run[\s\S]*arm's 60/,
    )
  })

  // 8 cases x 3 attempts is 24 runs at once, twice the slots.
  it('names the agent, the runs it needs and the slots left', () => {
    expect(() => loader(HUGE_BUDGET_MS)(background)).toThrow(
      /meeting_briefing needs 24 runs in flight at once, and 12 of the arm's 12 slots/,
    )
  })

  // THE RUNNING TOTAL, which is what the per-agent check alone cannot see.
  // Two agents that each fit the slots can still overfill them together, and
  // the message has to say what was already taken or the numbers read as a
  // contradiction.
  it('spends the slots down across agents', () => {
    // Three runs each against four slots: the first fits, the second cannot.
    const load = loader(HUGE_BUDGET_MS, 3, 1, 4)
    expect(() => load(background)).not.toThrow()
    expect(() => load(background)).toThrow(
      /needs 3 runs in flight at once, and 1 of the arm's 4 slots were left/,
    )
  })

  // A refusal for slots takes none: with one slot left after the first agent,
  // a three-run agent is refused and a one-run agent after it still fits.
  it('leaves the slots of an agent refused for them', () => {
    const three = loader(HUGE_BUDGET_MS, 3, 1, 4)
    expect(() => three(background)).not.toThrow()
    expect(() => three(background)).toThrow(/needs 3 runs/)
    const one = caseLoaderFor(
      {},
      {
        budgetMs: HUGE_BUDGET_MS,
        attemptsPerCase: 1,
        maxCases: 3,
        maxInFlight: 4,
      },
      {
        load: (agent) =>
          caseList(
            'background',
            agent.agentId,
            agent.agentId === 'tiny' ? eight.slice(0, 1) : eight,
          ),
        loadBackground: (agent) =>
          agent.agentId === 'tiny' ? eight.slice(0, 1) : eight,
        loadConfig: () => config({ timeout_seconds: 600 }),
      },
    )
    expect(() => one(background)).not.toThrow()
    expect(() => one(background)).toThrow(/needs 3 runs/)
    expect(() => one({ ...background, agentId: 'tiny' })).not.toThrow()
  })

  // THE REGRESSION THIS REPLACED. A chat agent in the same selection must
  // still load, so captureArm still captures it and the sweep still produces
  // a verdict for the half that can.
  it('leaves a chat agent in the same sweep untouched', () => {
    expect(() => loader(1, undefined, 3, 0)(chat)).not.toThrow()
  })

  it('allows an agent that fits', () => {
    expect(() => loader(HUGE_BUDGET_MS, 3, 1)(background)).not.toThrow()
  })

  // THE CAP IS WHAT MAKES THE AGENT FIT, so it has to be applied before the
  // slots are counted. Counted against the file instead, the refusal fires on
  // a list the sweep was never going to walk.
  it('counts the capped list, not the file', () => {
    // 8 runs is over four slots; 3 is not.
    expect(() => loader(HUGE_BUDGET_MS, undefined, 1, 4)(background)).toThrow()
    expect(() => loader(HUGE_BUDGET_MS, 3, 1, 4)(background)).not.toThrow()
  })

  // The first n, not a sample. Two arms that walked different cases have
  // nothing to pair, and both arms read this from one config.
  it('takes the first n cases so both arms walk the same ones', () => {
    const list = loader(HUGE_BUDGET_MS, 3, 3, 99)(background)
    expect(list.cases.map((one) => one.caseId)).toEqual(['c0', 'c1', 'c2'])
  })

  it('walks the whole list when no cap is set', () => {
    expect(
      loader(HUGE_BUDGET_MS, undefined, 3, 99)(background).cases,
    ).toHaveLength(8)
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
  // refused ones included, so a refusal that still took its slots would
  // starve every agent after it of slots it never used.
  it('does not charge a refused agent against the agents after it', () => {
    // A 60-minute arm and three slots. meeting_briefing's single run is 65
    // minutes, so it is refused; opposition_research needs all three slots,
    // which it only gets if the refusal took none of them.
    const load = caseLoaderFor(
      {},
      {
        budgetMs: 60 * 60 * 1000,
        attemptsPerCase: 1,
        maxCases: 3,
        maxInFlight: 3,
      },
      deps,
    )
    expect(() => load(background)).toThrow(/65 minutes for a single run/)
    expect(() => load(cheap)).not.toThrow()
  })

  // Refused for its manifest, an agent must not keep the slots: checked after
  // they were taken, the agents after it lost room it never used.
  it('takes no slots for an agent refused for its manifest', () => {
    const load = caseLoaderFor(
      {},
      {
        budgetMs: HUGE_BUDGET_MS,
        attemptsPerCase: 1,
        maxCases: 3,
        maxInFlight: 3,
      },
      {
        ...deps,
        loadConfig: (agentId: string) =>
          agentId === 'meeting_briefing'
            ? config({ model: undefined })
            : config({ timeout_seconds: 600 }),
      },
    )
    expect(() => load(background)).toThrow(/names no model/)
    expect(() => load(cheap)).not.toThrow()
  })

  // 0 judges nothing while reporting a clean arm; -1 is read by slice as
  // "all but the last". Refused when the loader is BUILT, before any agent.
  it.each([0, -1])('refuses a case cap of %i', (maxCases) => {
    expect(() =>
      caseLoaderFor(
        {},
        {
          budgetMs: HUGE_BUDGET_MS,
          attemptsPerCase: 1,
          maxCases,
          maxInFlight: 12,
        },
        deps,
      ),
    ).toThrow(/not a number of cases a sweep can walk/)
  })

  // ON A SWEEP, THE ADMITTED SET DECIDES, NOT THIS ARM'S OWN ARITHMETIC. Each
  // arm reads timeouts from its own worktree, so two arms deciding for
  // themselves disagree whenever a branch changes one.
  it('walks an admitted agent without re-deciding its budget', () => {
    // A 65-minute run is far over 1 ms, and there are no slots — and it is
    // walked anyway,
    // because the decision was taken once, for both arms, elsewhere.
    const load = caseLoaderFor(
      {},
      {
        budgetMs: 1,
        attemptsPerCase: 1,
        maxCases: 3,
        maxInFlight: 0,
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
        maxInFlight: 12,
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
        maxInFlight: 12,
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
        maxInFlight: 12,
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
        maxInFlight: 12,
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

  describe('by the wave, against a base that walks concurrently', () => {
    // In walk order, filling one set of slots: the arms start agents in this
    // order too, so an admission decided in any other order would disagree
    // with what the arms can hold.
    it('admits in walk order until the slots are spent', () => {
      const result = admitBackground(
        [agent('a'), agent('b'), agent('c')],
        () => ({ runs: 3, runMs: minutes(30) }),
        minutes(70),
        7,
      )
      expect(result.admitted).toEqual(['a', 'b'])
      expect(result.refused.map((one) => one.agentId)).toEqual(['c'])
      expect(result.refused[0]?.reason).toMatch(
        /needs 3 runs in flight at once, and 1 of the arm's 7 slots/,
      )
    })

    // Slots are not time: an agent with room to spare is still refused if
    // one of its runs alone outlasts the arm.
    it('refuses a run longer than the arm, however many slots are free', () => {
      const result = admitBackground(
        [agent('slow')],
        () => ({ runs: 1, runMs: minutes(80) }),
        minutes(70),
        12,
      )
      expect(result.admitted).toEqual([])
      expect(result.refused[0]?.reason).toMatch(
        /80 minutes for a single run[\s\S]*arm's 70/,
      )
    })

    // The margin: a run has to leave five minutes of the arm for staging and
    // recording, so 65 fits a 70-minute arm and 66 does not.
    it.each<[number, string[]]>([
      [65, ['edge']],
      [66, []],
    ])(
      'admits a %i-minute run only with the margin left',
      (runMinutes, admitted) => {
        const result = admitBackground(
          [agent('edge')],
          () => ({ runs: 1, runMs: minutes(runMinutes) }),
          minutes(70),
          12,
        )
        expect(result.admitted).toEqual(admitted)
      },
    )

    // Exactly the slots left fits; one more does not.
    it.each<[number, string[]]>([
      [7, ['full']],
      [8, []],
    ])('admits %i runs against 7 slots only if they fit', (runs, admitted) => {
      const result = admitBackground(
        [agent('full')],
        () => ({ runs, runMs: minutes(30) }),
        minutes(70),
        7,
      )
      expect(result.admitted).toEqual(admitted)
    })

    // A refused agent takes no slots, so a smaller one after it still fits.
    it('lets a later small agent through after a large one is refused', () => {
      const runs: Record<string, number> = { big: 10, small: 7 }
      const result = admitBackground(
        [agent('big'), agent('small')],
        (one) => ({ runs: runs[one.agentId] ?? 0, runMs: minutes(30) }),
        minutes(70),
        7,
      )
      expect(result.admitted).toEqual(['small'])
    })

    // Wall clock does not add up across a wave: four agents of 65-minute runs
    // all fit a 70-minute arm, which the run-after-run rule would refuse.
    it('does not add the agents up in time', () => {
      const result = admitBackground(
        [agent('a'), agent('b'), agent('c'), agent('d')],
        () => ({ runs: 3, runMs: minutes(65) }),
        minutes(70),
        12,
      )
      expect(result.admitted).toEqual(['a', 'b', 'c', 'd'])
    })
  })

  describe('one run after another, against a base that does not', () => {
    it('admits in walk order until the time is spent', () => {
      const result = admitBackground(
        [agent('a'), agent('b'), agent('c')],
        () => ({ runs: 1, runMs: minutes(30) }),
        minutes(70),
      )
      expect(result.admitted).toEqual(['a', 'b'])
      expect(result.refused[0]?.reason).toMatch(
        /one run after another[\s\S]*10 of the arm's 70 were left/,
      )
    })

    // Exactly the time left still fits.
    it('admits an agent that uses exactly the time left', () => {
      const result = admitBackground(
        [agent('exact')],
        () => ({ runs: 1, runMs: minutes(70) }),
        minutes(70),
      )
      expect(result.admitted).toEqual(['exact'])
    })

    // A refused agent claims no case ids: refused for time, it must not
    // then block a later agent that shares them.
    it('lets an agent through whose case ids a refused agent shared', () => {
      const runMs: Record<string, number> = {
        big: minutes(200),
        small: minutes(20),
      }
      const result = admitBackground(
        [agent('big'), agent('small')],
        (one) => ({
          runs: 1,
          runMs: runMs[one.agentId] ?? 0,
          caseIds: ['shared'],
        }),
        minutes(70),
      )
      expect(result.admitted).toEqual(['small'])
    })

    // Every run is charged, not one per agent.
    it('charges each agent for all of its runs', () => {
      const result = admitBackground(
        [agent('a'), agent('b')],
        () => ({ runs: 2, runMs: minutes(30) }),
        minutes(70),
      )
      expect(result.admitted).toEqual(['a'])
    })

    it('lets a later cheap agent through after an expensive one is refused', () => {
      const runMs: Record<string, number> = {
        big: minutes(200),
        small: minutes(20),
      }
      const result = admitBackground(
        [agent('big'), agent('small')],
        (one) => ({ runs: 1, runMs: runMs[one.agentId] ?? 0 }),
        minutes(70),
      )
      expect(result.admitted).toEqual(['small'])
    })
  })

  it('carries a refusal from the cost through, and skips chat agents', () => {
    const result = admitBackground(
      [agent('chief_of_staff', 'chat'), agent('new_one')],
      () => ({ refused: 'is not on the base ref' }),
      minutes(70),
      12,
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
      background: { attemptsPerCase: 1, maxCases: 1, maxInFlight: 12 },
    }
    const deps = armDeps(
      env({ fixtureValues: SWEEP_VALUES }),
      config,
      ARM_BUDGET_MS,
    )
    expect(deps.config).toBe(config)
    expect(deps.loadCases(real('opposition_research')).cases).toHaveLength(1)
  })

  // ONE loader for the arm, so the slots are spent across agents. At the
  // default three runs each against twelve slots, four agents fit and the
  // fifth does not — which only holds if every call shares one set.
  it('spends one set of slots across every agent the arm walks', () => {
    const { loadCases } = armDeps(
      env({ fixtureValues: SWEEP_VALUES }),
      DEFAULT_JUDGE_CONFIG,
      ARM_BUDGET_MS,
    )
    for (const id of [
      'opportunities_and_challenges',
      'opposition_research',
      'race_opponent_actions',
      'race_opponent_summary',
    ]) {
      expect(() => loadCases(real(id))).not.toThrow()
    }
    expect(() => loadCases(real('district_issue_pulse'))).toThrow(
      /needs 3 runs in flight at once, and 0 of the arm's 12 slots/,
    )
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
  const other = { ...background, agentId: 'self_research' }
  const chat = {
    ...background,
    agentId: 'chief_of_staff',
    shape: 'chat' as const,
  }
  const one: BackgroundCase[] = [{ caseId: 'case-1', params: {} }]
  // What the arm does with this env: load the agent's cases through the
  // loader the arm builds, then build the first dispatch. Either throwing is a
  // refusal before anything is staged; the message says which.
  const armRefusal = (
    agent: typeof background,
    arm: ArmEnv,
    cases: BackgroundCase[] = one,
  ): string => {
    try {
      const budget = {
        budgetMs: HUGE_BUDGET_MS,
        attemptsPerCase: 1,
        maxCases: undefined,
        maxInFlight: 12,
      }
      caseLoaderFor(
        arm.fixtureValues,
        arm.backgroundAdmitted === undefined
          ? budget
          : { ...budget, admitted: arm.backgroundAdmitted },
        {
          load: () => caseList('background', agent.agentId, cases),
          loadBackground: () => cases,
          loadConfig: () => config(),
        },
      )(agent)
      backgroundRunInputFor(request({ agent }), arm, () => config())
      return ''
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
  }

  it.each<[string, typeof background, Partial<ArmEnv>, RegExp]>([
    [
      'not admitted',
      background,
      { backgroundAdmitted: new Set(['someone_else']) },
      /was not admitted/,
    ],
    // A different agent, with the default one admitted, so a predicate that
    // asked about one fixed id rather than this agent's cannot pass.
    [
      'another agent not admitted',
      other,
      { backgroundAdmitted: new Set([background.agentId]) },
      /was not admitted/,
    ],
    [
      'admitted list empty',
      background,
      { backgroundAdmitted: new Set() },
      /was not admitted/,
    ],
    [
      'no identifiers resolved',
      background,
      { fixtureValues: {} },
      /resolved no judge identifiers/,
    ],
    [
      'no dispatch queue',
      background,
      { dispatchQueueUrl: undefined },
      /JUDGE_DISPATCH_QUEUE_URL/,
    ],
  ])(
    'counts %s as refused, and the arm does refuse it',
    (_, agent, over, why) => {
      const arm = env(over)
      expect(armRefusal(agent, arm)).toMatch(why)
      expect(refusedBeforeSpend(agent, arm, () => one)).toBe(true)
    },
  )

  // A GP-API READER NEEDS NONE OF THE SWEEP'S IDENTIFIERS. It dispatches as
  // the seeded fixture, so a sweep whose identifiers step produced nothing
  // must still run it, slug placeholder included, on both checks that decide.
  it('runs a gp-api reader when the sweep resolved no identifiers', () => {
    const reader = { ...background, readsGpApi: true as const }
    const slugCase: BackgroundCase[] = [
      { caseId: 'case-1', params: { organization_slug: '{judgeOrgSlug}' } },
    ]
    const arm = env({ fixtureValues: {} })
    expect(armRefusal(reader, arm, slugCase)).toBe('')
    expect(refusedBeforeSpend(reader, arm, () => slugCase)).toBe(false)
    expect(
      backgroundRunInputFor(request({ agent: reader }), arm, () => config())
        .organizationSlug,
    ).toBe(JUDGE_FIXTURE.orgSlug)
  })

  // Only the slug is the fixture's. Everything else still refuses a reader.
  it('still refuses a gp-api reader with no queue or a value it lacks', () => {
    const reader = { ...background, readsGpApi: true as const }
    expect(
      refusedBeforeSpend(
        reader,
        env({ fixtureValues: {}, dispatchQueueUrl: undefined }),
        () => one,
      ),
    ).toBe(true)
    const raceCase: BackgroundCase[] = [
      { caseId: 'case-1', params: { race_id: '{judgeRaceId}' } },
    ]
    expect(
      refusedBeforeSpend(reader, env({ fixtureValues: {} }), () => raceCase),
    ).toBe(true)
  })

  // A VALUE THE SWEEP COULD NOT RESOLVE. The race goes missing once the named
  // election has passed; the loader then refuses exactly the lists that need
  // it, and that has to read as a refusal by design, or the base arm goes red
  // and the candidate arm never runs.
  describe('when the sweep has no race id', () => {
    const noRace = env({ fixtureValues: { orgSlug: 'judge-1-1' } })
    const needsRace: BackgroundCase[] = [
      { caseId: 'c1', params: { race_id: '{judgeRaceId}' } },
    ]
    const slugOnly: BackgroundCase[] = [
      { caseId: 'c1', params: { organization_slug: '{judgeOrgSlug}' } },
    ]

    it('counts a list that needs one as refused, and the arm does refuse it', () => {
      expect(armRefusal(background, noRace, needsRace)).toMatch(
        /unsubstituted placeholder/,
      )
      expect(refusedBeforeSpend(background, noRace, () => needsRace)).toBe(true)
    })

    it('does not count a list that needs none, and the arm runs it', () => {
      expect(armRefusal(background, noRace, slugOnly)).toBe('')
      expect(refusedBeforeSpend(background, noRace, () => slugOnly)).toBe(false)
    })

    // Only the cases the arm walks count: a race needed by the fifth case,
    // past the cap of three, refuses nothing.
    it('ignores a value only an unwalked case needs', () => {
      const five: BackgroundCase[] = [
        ...Array.from({ length: 4 }, (_, i) => ({
          caseId: `c${i}`,
          params: { organization_slug: '{judgeOrgSlug}' },
        })),
        { caseId: 'c4', params: { race_id: '{judgeRaceId}' } },
      ]
      const walked = walkedBackgroundCases(background, noRace, () => five)
      expect(walked.map((one) => one.caseId)).toEqual(['c0', 'c1', 'c2'])
      expect(
        refusedBeforeSpend(background, noRace, (agent) =>
          walkedBackgroundCases(agent, noRace, () => five),
        ),
      ).toBe(false)
    })

    // No list, no reason: answered without reading any file.
    it('reads no list for an agent that has none', () => {
      expect(refusedBeforeSpend({ ...background, cases: null }, noRace)).toBe(
        false,
      )
    })

    // An unknown token is a broken list, not a missing value: still red.
    it('does not excuse a token outside the vocabulary', () => {
      const broken = [{ caseId: 'c1', params: { x: '{judgeTypo}' } }]
      expect(armRefusal(background, noRace, broken)).toMatch(
        /not a placeholder/,
      )
      expect(refusedBeforeSpend(background, noRace, () => broken)).toBe(false)
    })
  })

  // The arm refuses these too, but a missing bucket is a line the workflow
  // dropped, not a state it can reach on purpose, so the arm must stay red.
  it.each<[string, Partial<ArmEnv>, RegExp]>([
    [
      'a missing metadata bucket',
      { metadataBucket: undefined },
      /JUDGE_METADATA_BUCKET/,
    ],
    [
      'a missing artifact bucket',
      { artifactBucket: undefined },
      /JUDGE_ARTIFACT_BUCKET/,
    ],
  ])('does not excuse %s', (_, over, why) => {
    const arm = env(over)
    expect(armRefusal(background, arm)).toMatch(why)
    expect(refusedBeforeSpend(background, arm, () => one)).toBe(false)
  })

  it.each<[string, Partial<ArmEnv>]>([
    [
      'admitted, with everything it needs',
      { backgroundAdmitted: new Set([background.agentId]) },
    ],
    ['a local run, which has no admitted list', {}],
  ])('does not count %s, and the arm does dispatch it', (_, over) => {
    const arm = env(over)
    expect(armRefusal(background, arm)).toBe('')
    expect(refusedBeforeSpend(background, arm, () => one)).toBe(false)
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
          dispatchQueueUrl: undefined,
        }),
      ),
    ).toBe(false)
  })
})

// The arm suite's final check reads this, and that suite never runs in CI, so
// this is where its rule is held: what it must have captured, by id.
describe('capturableAgents', () => {
  const registry: AgentEntry[] = [
    {
      agentId: 'chief_of_staff',
      shape: 'chat',
      cases: 'cos.json',
      status: 'wired',
    },
    {
      agentId: 'meeting_briefing',
      shape: 'background',
      cases: 'mb.json',
      status: 'wired',
    },
    {
      agentId: 'self_research',
      shape: 'background',
      cases: 'sr.json',
      status: 'wired',
    },
    { agentId: 'no_list', shape: 'chat', cases: null, status: 'wired' },
    {
      agentId: 'blocked_one',
      shape: 'chat',
      cases: 'b.json',
      status: 'blocked',
    },
  ]
  const find = (id: string) => registry.find((one) => one.agentId === id)

  it('expects every chat agent with a list, and every admitted background one', () => {
    expect(
      capturableAgents(
        ['chief_of_staff', 'meeting_briefing', 'self_research'],
        env({ backgroundAdmitted: new Set(['meeting_briefing']) }),
        find,
        DEFAULT_JUDGE_CONFIG,
        () => [],
      ),
    ).toEqual(['chief_of_staff', 'meeting_briefing'])
  })

  // THE REAL LISTS, through the default loader: with no race id,
  // opposition_research (race_id and user_email) is excused and
  // find_existing_ordinances (slug only) is still expected.
  it('excuses the real lists that need a missing race, and only those', () => {
    expect(
      capturableAgents(
        ['opposition_research', 'find_existing_ordinances'],
        env({
          fixtureValues: {
            orgSlug: 'judge-1-1',
            userEmail: 'judge-sweep@example.com',
          },
          backgroundAdmitted: new Set([
            'opposition_research',
            'find_existing_ordinances',
          ]),
        }),
        findAgent,
        DEFAULT_JUDGE_CONFIG,
      ),
    ).toEqual(['find_existing_ordinances'])
  })

  it('leaves out an agent with no list, a blocked one and an unknown id', () => {
    expect(
      capturableAgents(
        ['no_list', 'blocked_one', 'not_an_agent', 'chief_of_staff'],
        env(),
        find,
        DEFAULT_JUDGE_CONFIG,
        () => [],
      ),
    ).toEqual(['chief_of_staff'])
  })

  // The case that broke sweeps: nothing background could dispatch, and the
  // chat agent is still expected — so it is the chat skip that goes red.
  it('still expects the chat agents when every background one is refused', () => {
    expect(
      capturableAgents(
        ['meeting_briefing', 'chief_of_staff'],
        env({ fixtureValues: {} }),
        find,
        DEFAULT_JUDGE_CONFIG,
        () => [],
      ),
    ).toEqual(['chief_of_staff'])
  })
})

// THE CHAT HALF OF THE ARM. Nothing times a chat turn out, so before this a
// selection with more turns than an arm holds was killed by the vitest
// timeout with no manifest written.
describe('the chat budget', () => {
  const chatAgent = (agentId: string): AgentEntry => ({
    agentId,
    shape: 'chat',
    cases: `${agentId}.json`,
    status: 'pending',
  })
  const registered = (agentId: string): AgentEntry => {
    const found = findAgent(agentId)
    if (found === undefined) throw new Error(`${agentId} is not registered`)
    return found
  }

  // 65 minutes for chat. chief_of_staff 8 minutes, priority_flow 48, and
  // ordinance_flow's 48 more does not fit; campaign_assistant's 6 still
  // does, which only holds if the refused agent left its share behind.
  it('refuses by name what does not fit, and leaves its share to the next', () => {
    const count: Record<string, number> = {
      chief_of_staff: 24,
      priority_flow: 24,
      ordinance_flow: 24,
      campaign_assistant: 3,
    }
    const refused = refuseChat(
      Object.keys(count).map(chatAgent),
      (agent) => count[agent.agentId] ?? 0,
      ARM_BUDGET_MS,
    )
    expect(refused.map((one) => one.agentId)).toEqual(['ordinance_flow'])
    expect(refused[0]?.reason).toMatch(
      /^would take about 48 minutes for 24 chat turns at 120s each, and 9 of the arm's 70/,
    )
  })

  // Exactly the chat budget is a fit; one turn more is not.
  it('admits turns that fill the chat budget exactly, and no more', () => {
    const turnMs = chatTurnMsFor('chief_of_staff')
    const exact = chatBudgetMs(ARM_BUDGET_MS) / turnMs
    expect(Number.isInteger(exact)).toBe(true)
    const cos = [chatAgent('chief_of_staff')]
    expect(refuseChat(cos, () => exact, ARM_BUDGET_MS)).toEqual([])
    expect(refuseChat(cos, () => exact + 1, ARM_BUDGET_MS)).toHaveLength(1)
  })

  // Rounded up: 80 seconds is "about 2 minutes", never "about 1".
  it('rounds a partial minute up', () => {
    expect(
      refuseChat([chatAgent('chief_of_staff')], () => 4, WAVE_MARGIN_MS)[0]
        ?.reason,
    ).toMatch(/^would take about 2 minutes for 4 chat turns at 20s each/)
  })

  it('plans an agent nobody has timed at the slowest measured turn', () => {
    expect(chatTurnMsFor('a_new_chat_agent')).toBe(UNMEASURED_CHAT_TURN_MS)
    expect(UNMEASURED_CHAT_TURN_MS).toBe(
      Math.max(...Object.values(CHAT_TURN_MS).map((ms) => ms ?? 0)),
    )
  })

  it('leaves background agents and chat agents with no list to others', () => {
    const background: AgentEntry = {
      ...chatAgent('meeting_briefing'),
      shape: 'background',
    }
    const noList: AgentEntry = { ...chatAgent('no_list'), cases: null }
    expect(
      refuseChat([background, noList], () => 10_000, ARM_BUDGET_MS),
    ).toEqual([])
  })

  // A case of several turns drives every one of them.
  it('counts the turns a list drives, not its cases', () => {
    expect(
      chatTurnsIn(
        caseList('chat', 'chief_of_staff', [
          { caseId: 'one', question: 'hello' },
          { caseId: 'three', turns: ['a', 'b', 'c'] },
        ]),
      ),
    ).toBe(4)
  })

  // THE PIN ON THE REAL REGISTRY. Any one chat agent has to fit an arm on its
  // own, or naming it alone is a sweep that can never judge it. Fails when a
  // case list or config.attemptsPerCase grows past what an arm holds.
  it.each(
    AGENTS.filter(
      (agent) =>
        agent.shape === 'chat' &&
        agent.status !== 'blocked' &&
        agent.cases !== null,
    ).map((agent) => [agent.agentId, agent] as const),
  )('fits %s in an arm on its own', (_id, agent) => {
    expect(
      refuseChat(
        [agent],
        (one) =>
          chatTurnsIn(loadCaseList(one)) * DEFAULT_JUDGE_CONFIG.attemptsPerCase,
        ARM_BUDGET_MS,
      ),
    ).toEqual([])
  })

  // A sweep obeys the resolver's names and nothing else, so both arms
  // refuse the same agents whatever their own lists hold.
  it('refuses a chat agent the resolver named, with its reason', () => {
    const many: JudgeCase[] = Array.from({ length: 1_000 }, (_, i) => ({
      caseId: `c${i}`,
      question: 'hello',
    }))
    const load = caseLoaderFor(
      {},
      {
        budgetMs: ARM_BUDGET_MS,
        attemptsPerCase: 1,
        maxCases: undefined,
        maxInFlight: 12,
        admitted: new Set(),
        refusedReasons: new Map([['ordinance_flow', 'would take 99 minutes']]),
      },
      { load: (agent) => caseList('chat', agent.agentId, many) },
    )
    expect(() => load(chatAgent('ordinance_flow'))).toThrow(
      /^ordinance_flow was not admitted to this sweep: would take 99 minutes$/,
    )
    expect(load(chatAgent('chief_of_staff')).cases).toHaveLength(1_000)
  })

  // A LOCAL RUN, through the arm's own entry points and the real lists: no
  // resolver, so the arm works the refusal out itself, and the suite's final
  // check reads the same refusal as one by design rather than a failure.
  it('refuses on a local run by the same rule, and expects only the rest', () => {
    const ids = ['chief_of_staff', 'campaign_assistant', 'priority_flow']
    const arm = parseArmEnv(armEnvFor({ JUDGE_AGENTS: ids.join(',') }))
    expect(arm.backgroundRefused).toBeUndefined()
    const { loadCases } = armDeps(arm, DEFAULT_JUDGE_CONFIG)
    expect(loadCases(registered('chief_of_staff')).cases).toHaveLength(8)
    expect(loadCases(registered('campaign_assistant')).cases).toHaveLength(8)
    expect(() => loadCases(registered('priority_flow'))).toThrow(
      /^priority_flow was not admitted to this sweep: would take about 48 minutes for 24 chat turns at 120s each/,
    )
    expect(capturableAgents(ids, arm, findAgent, DEFAULT_JUDGE_CONFIG)).toEqual(
      ['chief_of_staff', 'campaign_assistant'],
    )
  })

  // The arm suite's final check: a chat agent the resolver refused is a
  // designed skip, not a failed capture that turns the arm red.
  it('counts a chat agent the resolver named as refused before spend', () => {
    const named = env({
      backgroundRefused: new Map([['ordinance_flow', 'too slow']]),
    })
    expect(refusedBeforeSpend(chatAgent('ordinance_flow'), named)).toBe(true)
    expect(refusedBeforeSpend(chatAgent('chief_of_staff'), named)).toBe(false)
    expect(
      capturableAgents(
        ['chief_of_staff', 'ordinance_flow'],
        named,
        (id) => chatAgent(id),
        DEFAULT_JUDGE_CONFIG,
      ),
    ).toEqual(['chief_of_staff'])
  })

  // Required, so the suite cannot drop it and read a local refusal as a
  // failure. Never called: tsc is what checks it.
  it('requires the config', () => {
    const omitted = () =>
      // @ts-expect-error config is required
      capturableAgents(['chief_of_staff'], env(), findAgent)
    expect(typeof omitted).toBe('function')
  })

  it('counts a list it cannot read as no turns, and does not throw', () => {
    const decided = withChatRefusals(
      env({ agentIds: ['chief_of_staff'] }),
      DEFAULT_JUDGE_CONFIG,
      findAgent,
      () => {
        throw new Error('unreadable')
      },
    )
    expect(decided.backgroundRefused).toEqual(new Map())
  })

  // Named twice, walked once: charged twice it would refuse itself.
  it('decides an agent named twice once on a local run', () => {
    expect(
      withChatRefusals(
        env({ agentIds: ['priority_flow', 'priority_flow'] }),
        DEFAULT_JUDGE_CONFIG,
      ).backgroundRefused,
    ).toEqual(new Map())
  })

  // Through the registry the caller hands in, not the global one: big1 and
  // big2 resolve only there, to two real 48-minute lists. loadCaseList ties
  // a list to its own agent id, so each maps to the agent that owns it.
  it('works the local refusals out from the registry it is given', () => {
    const owners: Record<string, string> = {
      big1: 'ordinance_flow',
      big2: 'priority_flow',
    }
    const find = (id: string): AgentEntry | undefined => {
      const owner = owners[id]
      return owner === undefined ? undefined : registered(owner)
    }
    const ids = Object.keys(owners)
    const each = (id: string): number => {
      const agent = registered(owners[id] ?? '')
      return (
        chatTurnsIn(loadCaseList(agent)) *
        DEFAULT_JUDGE_CONFIG.attemptsPerCase *
        chatTurnMsFor(agent.agentId)
      )
    }
    let msLeft = chatBudgetMs(ARM_BUDGET_MS)
    const expected = ids.filter((id) => {
      if (each(id) > msLeft) return false
      msLeft -= each(id)
      return true
    })
    expect(expected.length).toBeGreaterThan(0)
    expect(expected.length).toBeLessThan(ids.length)
    expect(
      capturableAgents(ids, env({ agentIds: ids }), find, DEFAULT_JUDGE_CONFIG),
    ).toEqual(expected)
  })
})

import { describe, expect, it } from 'vitest'
import {
  POLL_HEADROOM_MS,
  backgroundRunInputFor,
  caseLoaderFor,
} from './backgroundDispatch'
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
      HUGE_BUDGET_MS,
      3,
      undefined,
      () => caseList('background', agent.agentId, decoy),
      () => withToken,
      () => config(),
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
        HUGE_BUDGET_MS,
        3,
        undefined,
        () => caseList('background', agent.agentId, mixed),
        () => mixed,
        () => config(),
      )(agent),
    ).toThrow(/c8/)
  })

  it('leaves a chat list alone', () => {
    const cases = [{ caseId: 'c1', turns: ['hello'] }]
    const list = caseLoaderFor(
      { orgSlug: 'judge-fixture-1' },
      HUGE_BUDGET_MS,
      3,
      undefined,
      () => caseList('chat', chat.agentId, cases),
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
  const loader = (budgetMs: number, maxCases?: number, attempts = 3) =>
    caseLoaderFor(
      {},
      budgetMs,
      attempts,
      maxCases,
      (agent) =>
        agent.shape === 'background'
          ? caseList('background', agent.agentId, eight)
          : caseList('chat', agent.agentId, [{ caseId: 'c1', turns: ['hi'] }]),
      () => eight,
      () => config({ timeout_seconds: 3600 }),
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

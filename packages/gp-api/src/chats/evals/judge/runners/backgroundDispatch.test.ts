import { describe, expect, it } from 'vitest'
import {
  POLL_HEADROOM_MS,
  backgroundRunInputFor,
  backgroundWorstCaseMs,
  caseLoaderFor,
  describeBudgetOverrun,
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

const env = (over: Partial<ArmEnv> = {}): ArmEnv => ({
  sweepId: 'sweep-1',
  agentIds: ['meeting_briefing'],
  spends: true,
  explicitSelection: false,
  recordsDir: '/tmp/records',
  arm: 'candidate',
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
  sweepId: 'sweep-1',
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
      sweepId: 'sweep-1',
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

  // WHY THE POLL IS DERIVED AND NOT A CONSTANT. A flat 15 minutes was shorter
  // than eleven of the sixteen published agents' own `timeout_seconds`, so a
  // perfectly healthy run was abandoned inside its own budget: the money was
  // already spent, the Fargate task kept going, and the record came back an
  // infraError that the delta excludes. Both arms, every attempt.
  it.each([
    [1200, 1200 * 1000 + POLL_HEADROOM_MS],
    [3600, 3600 * 1000 + POLL_HEADROOM_MS],
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

describe('backgroundWorstCaseMs', () => {
  const agents = [
    { agentId: 'meeting_briefing', shape: 'background' },
    { agentId: 'chief_of_staff', shape: 'chat' },
  ]

  // cases x attempts x the agent's own poll, because walkCases is sequential.
  // The arithmetic is the finding: 8 cases at 3 attempts is 24 runs, and at
  // meeting_briefing's declared hour that is fourteen hours for ONE agent on
  // ONE arm, against a job budget of three.
  it('multiplies cases by attempts by the agent own poll', () => {
    const worst = backgroundWorstCaseMs(
      agents,
      3,
      () => 8,
      () => config({ timeout_seconds: 3600 }),
    )
    expect(worst.totalMs).toBe(8 * 3 * (3600 * 1000 + POLL_HEADROOM_MS))
  })

  // A chat agent costs turns, not a Fargate poll, and counting it here would
  // refuse a sweep over time it is not going to spend.
  it('counts only the background agents', () => {
    const worst = backgroundWorstCaseMs(
      agents,
      3,
      () => 8,
      () => config(),
    )
    expect(worst.perAgent.map((one) => one.agentId)).toEqual([
      'meeting_briefing',
    ])
  })

  it('is zero for a chat-only selection', () => {
    const worst = backgroundWorstCaseMs(
      [{ agentId: 'chief_of_staff', shape: 'chat' }],
      3,
      () => 8,
      () => config(),
    )
    expect(worst.totalMs).toBe(0)
  })
})

describe('describeBudgetOverrun', () => {
  // The refusal has to say WHICH agents and HOW LONG, slowest first. A
  // sentence that only says "too long" leaves the reader to work out what to
  // deselect, which is the one thing they need from it.
  it('names the agents slowest first, with both numbers', () => {
    const message = describeBudgetOverrun(
      {
        totalMs: 90 * 60 * 1000,
        perAgent: [
          { agentId: 'quick', ms: 30 * 60 * 1000 },
          { agentId: 'slow', ms: 60 * 60 * 1000 },
        ],
      },
      70 * 60 * 1000,
    )
    expect(message).toContain('90')
    expect(message).toContain('70')
    expect(message.indexOf('slow 60m')).toBeLessThan(
      message.indexOf('quick 30m'),
    )
  })
})

describe('caseLoaderFor', () => {
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
    const list = caseLoaderFor(
      { orgSlug: 'judge-fixture-1' },
      () => caseList('background', agent.agentId, withToken),
      () => withToken,
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
        () => caseList('background', agent.agentId, mixed),
        () => mixed,
      )(agent),
    ).toThrow(/c8/)
  })

  it('leaves a chat list alone', () => {
    const cases = [{ caseId: 'c1', turns: ['hello'] }]
    const list = caseLoaderFor({ orgSlug: 'judge-fixture-1' }, () =>
      caseList('chat', chat.agentId, cases),
    )(chat)
    expect(list.cases).toEqual(cases)
  })
})

import { describe, expect, it } from 'vitest'
import { AGENTS, findAgent, type AgentEntry } from './agents'
import {
  assertNoPlaceholders,
  JUDGE_PLACEHOLDERS,
  substituteBackgroundCases,
} from './caseParams'
import { loadCaseList, type BackgroundCase } from './cases'

// The six background agents whose input_schema names an identifier that has to
// resolve against a real organization, so their case lists carry a `{judge…}`
// token and a sweep carries the value. Named here rather than derived from the
// registry, because deriving them would make this file agree with whatever the
// registry says — including a registry that lost one.
//
// Everything these lists share with the other nine — that they parse through
// the loader, are `placeholder: true`, hold eight uniquely-named cases, and
// satisfy their manifest's `required` and `additionalProperties: false` — is
// checked for all fifteen in backgroundCaseLists.test.ts. What is only true
// here is the placeholder behaviour, and that is all this file asserts.
const AUTHORED = [
  'campaign_tracker_tasks',
  'find_existing_ordinances',
  'opportunities_and_challenges',
  'opposition_research',
  'top_community_issues',
  'trending_issues',
] as const

// Which tokens each list is expected to carry. Asserted per agent rather than
// "at least one somewhere", because a list that lost its org token would still
// parse, still satisfy the input_schema, and dispatch against whatever literal
// took its place.
const EXPECTED_TOKENS: Record<(typeof AUTHORED)[number], string[]> = {
  campaign_tracker_tasks: [JUDGE_PLACEHOLDERS.raceId],
  find_existing_ordinances: [JUDGE_PLACEHOLDERS.orgSlug],
  opportunities_and_challenges: [
    JUDGE_PLACEHOLDERS.raceId,
    JUDGE_PLACEHOLDERS.userEmail,
  ],
  opposition_research: [
    JUDGE_PLACEHOLDERS.raceId,
    JUDGE_PLACEHOLDERS.userEmail,
  ],
  top_community_issues: [JUDGE_PLACEHOLDERS.orgSlug],
  trending_issues: [JUDGE_PLACEHOLDERS.orgSlug],
}

// What a sweep would hand these lists. Shaped like the real values so a
// substituted params object is the one that would be dispatched.
const SWEEP_VALUES = {
  orgSlug: 'eo-0192e4a0-1f00-7000-8000-0000000c0de1',
  raceId: 'gAAAAABkRaCeIdFromBallotReady',
  userEmail: 'qa-6f1c9d84-3b52-4a27-9e0f-7c3d51ab2049@goodparty.org',
}

const agentFor = (agentId: string): AgentEntry => {
  const agent = findAgent(agentId)
  if (agent === undefined) throw new Error(`${agentId} left the registry`)
  return agent
}

// The loader returns a JudgeCase, which is a chat case or a background one.
// Narrowed here rather than cast, so a list filed against the wrong shape
// fails naming the case instead of arriving at substitution without params.
const backgroundCases = (agentId: string): BackgroundCase[] =>
  loadCaseList(agentFor(agentId)).cases.map((one) => {
    if (!('params' in one)) {
      throw new Error(`${agentId}/${one.caseId} carries no params`)
    }
    return one
  })

describe('the six fixture-backed background case lists', () => {
  // `wired` means an agent has produced a real verdict at least once. None of
  // these has been dispatched.
  it('leaves all six pending', () => {
    expect(AUTHORED.map((id) => agentFor(id).status)).toEqual(
      AUTHORED.map(() => 'pending'),
    )
  })

  it.each(AUTHORED)('%s carries the tokens it needs', (agentId) => {
    const serialized = JSON.stringify(backgroundCases(agentId))
    for (const token of EXPECTED_TOKENS[agentId]) {
      expect(serialized, token).toContain(token)
    }
  })

  // Every case, not one per list: a list is dispatched whole, and one case
  // that named a token nobody supplies is what the guard exists to catch.
  it.each(AUTHORED)('%s fully substitutes under a sweep', (agentId) => {
    const cases = backgroundCases(agentId)
    const substituted = substituteBackgroundCases(cases, SWEEP_VALUES)
    expect(substituted).toHaveLength(cases.length)
    for (const one of substituted) {
      expect(() => assertNoPlaceholders(one.caseId, one.params)).not.toThrow()
    }
  })

  // The failure this design exists to prevent, asserted on the real files:
  // with no fixture, the list refuses rather than dispatching a literal.
  it.each(AUTHORED)('%s refuses to dispatch without a fixture', (agentId) => {
    expect(() =>
      substituteBackgroundCases(backgroundCases(agentId), {}),
    ).toThrow(/unsubstituted placeholder/)
  })
})

// The other side of the partition. A token in a list nobody wired a fixture
// for would pass every check above — it is not in AUTHORED — and then be
// refused by `buildDispatchMessage` mid-sweep, after the money was committed.
// Derived from the registry on purpose here: the claim is about every
// background list there is, not about a list this file happens to name.
describe('the background lists that are not fixture-backed', () => {
  const OTHERS = AGENTS.filter(
    (agent) =>
      agent.shape === 'background' &&
      agent.cases !== null &&
      !AUTHORED.some((id) => id === agent.agentId),
  )

  it('there are nine of them', () => {
    expect(OTHERS).toHaveLength(9)
  })

  it.each(OTHERS)('$agentId needs no fixture at all', (agent) => {
    for (const one of backgroundCases(agent.agentId)) {
      expect(() => assertNoPlaceholders(one.caseId, one.params)).not.toThrow()
    }
  })
})

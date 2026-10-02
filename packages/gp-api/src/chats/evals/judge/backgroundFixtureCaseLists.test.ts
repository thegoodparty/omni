import { describe, expect, it } from 'vitest'
import { AGENTS, requireAgent } from './agents'
import {
  assertNoPlaceholders,
  JUDGE_PLACEHOLDERS,
  substituteBackgroundCases,
  type PlaceholderName,
} from './caseParams'
import { loadBackgroundCases } from './cases'
import { SWEEP_VALUES } from './fixtures/sweep'

// The six background agents whose input_schema names an identifier that has to
// resolve against a real organization, so their case lists carry a `{judge…}`
// token and a sweep carries the value. Named here rather than derived from the
// registry, because deriving them would make this file agree with whatever the
// registry says — including a registry that lost one.
//
// Everything these lists share with the other nine — that they parse through
// the loader, are `placeholder: true`, hold eight uniquely-named cases, and
// satisfy their manifest's `required` and its pinned `additionalProperties` —
// is checked for all fifteen in backgroundCaseLists.test.ts. What is only true
// here is the placeholder behaviour, and that is all this file asserts.
const AUTHORED = [
  'campaign_tracker_tasks',
  'find_existing_ordinances',
  'opportunities_and_challenges',
  'opposition_research',
  'top_community_issues',
  'trending_issues',
] as const

const CASES_PER_LIST = 8

// WHICH PARAM carries which token, not merely that the token appears
// somewhere in the file. A substring search over the whole list passes when
// seven of eight cases have lost the token, and when the token has moved from
// `organization_slug` into `state` — which is still schema-valid and still
// dispatched, against whatever literal took its place. Every one of the 48
// cases carries its tokens in exactly these named keys, so the precise
// assertion is available and the loose one is not worth having.
// Keyed by placeholder NAME rather than by token, so the token a case must
// carry and the value it must end up with both derive from one entry —
// JUDGE_PLACEHOLDERS[name] and SWEEP_VALUES[name] — and cannot disagree.
const TOKEN_PARAMS: Record<
  (typeof AUTHORED)[number],
  Partial<Record<PlaceholderName, string>>
> = {
  campaign_tracker_tasks: { raceId: 'race_id' },
  find_existing_ordinances: { orgSlug: 'organization_slug' },
  opportunities_and_challenges: {
    raceId: 'race_id',
    userEmail: 'user_email',
  },
  opposition_research: { raceId: 'race_id', userEmail: 'user_email' },
  top_community_issues: { orgSlug: 'organization_slug' },
  trending_issues: { orgSlug: 'organization_slug' },
}

// The (placeholder name, param key) pairs one agent's cases must carry.
const pairsFor = (agentId: (typeof AUTHORED)[number]) =>
  Object.entries(TOKEN_PARAMS[agentId]) as [PlaceholderName, string][]

const casesFor = (agentId: string) => loadBackgroundCases(requireAgent(agentId))

describe('the six fixture-backed background case lists', () => {
  // `wired` means an agent has produced a real verdict at least once. None of
  // these has been dispatched. The two that read the issue feed are blocked:
  // they call a gp-api tool a judge dispatch cannot authenticate.
  it('leaves four pending and blocks the two that read the issue feed', () => {
    expect(
      Object.fromEntries(AUTHORED.map((id) => [id, requireAgent(id).status])),
    ).toEqual(
      Object.fromEntries(
        AUTHORED.map((id) => [
          id,
          id === 'top_community_issues' || id === 'trending_issues'
            ? 'blocked'
            : 'pending',
        ]),
      ),
    )
  })

  it.each(AUTHORED)(
    '%s carries its tokens in the params that need them',
    (agentId) => {
      const cases = casesFor(agentId)
      expect(cases).toHaveLength(CASES_PER_LIST)
      const pairs = pairsFor(agentId)
      expect(pairs.length, agentId).toBeGreaterThan(0)
      for (const one of cases) {
        for (const [name, key] of pairs) {
          expect(one.params[key], `${agentId}/${one.caseId}.${key}`).toBe(
            JUDGE_PLACEHOLDERS[name],
          )
        }
      }
    },
  )

  // Every case, not one per list: a list is dispatched whole, and one case
  // that named a token nobody supplies is what the guard exists to catch.
  it.each(AUTHORED)('%s fully substitutes under a sweep', (agentId) => {
    const substituted = substituteBackgroundCases(
      casesFor(agentId),
      SWEEP_VALUES,
    )
    expect(substituted).toHaveLength(CASES_PER_LIST)
    for (const one of substituted) {
      for (const [name, key] of pairsFor(agentId)) {
        expect(one.params[key], `${agentId}/${one.caseId}.${key}`).toBe(
          SWEEP_VALUES[name],
        )
      }
      expect(() => assertNoPlaceholders(one.caseId, one.params)).not.toThrow()
    }
  })

  // The failure this design exists to prevent, asserted on the real files:
  // with no fixture, the list refuses rather than dispatching a literal.
  it.each(AUTHORED)('%s refuses to dispatch without a fixture', (agentId) => {
    expect(() => substituteBackgroundCases(casesFor(agentId), {})).toThrow(
      /unsubstituted placeholder/,
    )
  })

  // Substitution rebuilds; it must not edit the loaded list in place, since a
  // sweep holds one list and substitutes it once per arm.
  it.each(AUTHORED)('%s is left untouched by substitution', (agentId) => {
    const cases = casesFor(agentId)
    const before = JSON.stringify(cases)
    substituteBackgroundCases(cases, SWEEP_VALUES)
    expect(JSON.stringify(cases)).toBe(before)
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
    for (const one of loadBackgroundCases(agent)) {
      expect(() => assertNoPlaceholders(one.caseId, one.params)).not.toThrow()
    }
  })
})

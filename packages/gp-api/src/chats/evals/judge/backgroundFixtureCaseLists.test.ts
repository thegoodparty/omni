import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { findAgent } from './agents'
import {
  assertNoPlaceholders,
  JUDGE_PLACEHOLDERS,
  substituteBackgroundCases,
} from './caseParams'
import { JsonValueSchema } from './record'

// The six background agents whose input_schema names an identifier that has to
// resolve against the dev database. Named here rather than derived from the
// registry, because deriving them would make this file agree with whatever the
// registry says — including a registry that lost one.
const AUTHORED = [
  'campaign_tracker_tasks',
  'find_existing_ordinances',
  'opportunities_and_challenges',
  'opposition_research',
  'top_community_issues',
  'trending_issues',
] as const

// One baseline plus seven variations, the same shape the other background
// lists use. Well under gates.minCases, which is deliberate and recorded in
// every list's `note`.
const CASES_PER_LIST = 8

// Which tokens each list is expected to carry. Asserted per agent rather than
// "at least one somewhere", because a list that lost its org token would
// still parse, still validate against the input_schema, and dispatch against
// whatever literal took its place.
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

// The envelope these files have to satisfy. Narrow on purpose: this build has
// no shared case-list loader, and the checks that matter here are the ones
// specific to a placeholder-carrying list.
const EnvelopeSchema = z.object({
  agentId: z.string().min(1),
  shape: z.literal('background'),
  placeholder: z.literal(true),
  note: z.string().min(1),
  cases: z
    .array(
      z.object({
        caseId: z.string().regex(/^[A-Za-z0-9_-]+$/),
        params: z.record(z.string(), JsonValueSchema),
      }),
    )
    .min(1),
})

const CASES_DIR = path.join(__dirname, 'cases')

const load = (agentId: string) =>
  EnvelopeSchema.parse(
    JsonValueSchema.parse(
      JSON.parse(readFileSync(path.join(CASES_DIR, `${agentId}.json`), 'utf8')),
    ),
  )

describe('the six fixture-backed background case lists', () => {
  it('the registry points all six at their own file', () => {
    expect(AUTHORED.map((id) => findAgent(id)?.cases)).toEqual(
      AUTHORED.map((id) => `${id}.json`),
    )
  })

  // `wired` means an agent has produced a real verdict at least once. None of
  // these has been dispatched.
  it('leaves all six pending', () => {
    expect(AUTHORED.map((id) => findAgent(id)?.status)).toEqual(
      AUTHORED.map(() => 'pending'),
    )
  })

  it.each(AUTHORED)('%s is a well-formed background list', (agentId) => {
    const list = load(agentId)
    expect(list.agentId).toBe(agentId)
    // A verdict from a list nobody has dispatched is a claim about the
    // pipeline, not about the agent, and this flag is what carries that.
    expect(list.note).toContain('PLACEHOLDER')
    expect(list.cases).toHaveLength(CASES_PER_LIST)

    // Ids name stored records, so a duplicate would overwrite rather than add
    // and the sweep would judge fewer cases than it was billed for.
    const ids = list.cases.map((one) => one.caseId)
    expect(new Set(ids).size).toBe(CASES_PER_LIST)

    for (const one of list.cases) {
      expect(Object.keys(one.params).length, one.caseId).toBeGreaterThan(0)
    }
  })

  it.each(AUTHORED)('%s carries the tokens it needs', (agentId) => {
    const serialized = JSON.stringify(load(agentId).cases)
    for (const token of EXPECTED_TOKENS[agentId]) {
      expect(serialized, token).toContain(token)
    }
  })

  // Every case, not one per list: a list is dispatched whole, and one case
  // that named a token nobody supplies is what the guard exists to catch.
  it.each(AUTHORED)('%s fully substitutes under a sweep', (agentId) => {
    const substituted = substituteBackgroundCases(
      load(agentId).cases,
      SWEEP_VALUES,
    )
    expect(substituted).toHaveLength(CASES_PER_LIST)
    for (const one of substituted) {
      expect(() => assertNoPlaceholders(one.caseId, one.params)).not.toThrow()
    }
  })

  // The failure this design exists to prevent, asserted on the real files:
  // with no fixture, the list refuses rather than dispatching a literal.
  it.each(AUTHORED)('%s refuses to dispatch without a fixture', (agentId) => {
    expect(() => substituteBackgroundCases(load(agentId).cases, {})).toThrow(
      /unsubstituted placeholder/,
    )
  })
})

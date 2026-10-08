import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { requireAgent } from './agents'
import { caseDimensionsOf, loadBackgroundCases, loadCaseList } from './cases'
import { JsonValueSchema, type JsonValue } from './record'

// The registry-wide check that every named list is really on disk has to span
// both shapes, so it lives once, beside the chat lists, in
// chatCaseLists.test.ts.

// Every authored background list. Named here rather than derived from the
// registry, because deriving them would make this file agree with whatever the
// registry says — including a registry that lost one.
//
// Two authoring passes, and every check below applies to both: the first nine
// carry plain data, and the last six carry `{judge…}` placeholders their sweep
// substitutes (see backgroundFixtureCaseLists.test.ts). The manifest checks
// here read KEYS, so a placeholder value is validated the same as a literal
// one — which is the point, since a substituted list has to satisfy the same
// `required` and `additionalProperties` either way.
const AUTHORED = [
  'campaign_tracker_tasks',
  'district_issue_pulse',
  'district_issue_snapshot',
  'find_existing_ordinances',
  'meeting_briefing',
  'meeting_schedule',
  'opponent_research',
  'opportunities_and_challenges',
  'opposition_research',
  'race_opponent_actions',
  'race_opponent_collection',
  'race_opponent_summary',
  'self_research',
  'top_community_issues',
  'trending_issues',
] as const

// One baseline plus seven variations. Well under gates.minCases, which is
// deliberate and recorded in every list's `note`.
const CASES_PER_LIST = 8

// THESE LISTS ARE NOT PLACEHOLDERS. Melecia's background benches, taken
// verbatim and authored to test the agent rather than to exercise the
// pipeline, so each carries `placeholder: false`, which is what stops the
// report qualifying its verdict as "evidence the judge ran". The number is
// how many cases the bench ships with; without it a list that lost a case
// would still pass as "more than zero".
//
// Named here rather than branched on inline, so adding another real list is
// one edit and so the placeholder assertions below stay unambiguous about what
// they cover.
const REAL_CASE_COUNTS: Readonly<Record<string, number>> = {
  race_opponent_summary: 9,
  race_opponent_actions: 10,
}

// A background case's `params` is what the dispatch Lambda is called with, and
// the experiment manifest is the only statement of what that call accepts. The
// manifests live in another package, so this reaches across the repo on
// purpose: validating against a copy would only prove the copy.
//
// NOT a JSON Schema engine, and deliberately not: the monorepo declares no
// validator, and the two manifest facts that decide whether a dispatch is
// refused are `required` and `additionalProperties`. Types and patterns are
// left to the authored data being static.
const EXPERIMENTS = join(__dirname, '../../../../../runbooks/experiments')

type JsonObject = { [key: string]: JsonValue }

const asObject = (value: JsonValue | undefined, what: string): JsonObject => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${what}: expected a JSON object`)
  }
  return value
}

const readJson = (file: string): JsonValue =>
  JsonValueSchema.parse(JSON.parse(readFileSync(file, 'utf8')))

// Mirrors publish_experiments.py::_inline_refs, which is what makes a
// PUBLISHED manifest self-contained. Source manifests stay DRY, so a reader
// that skips this step sees a different schema than the Lambda enforces.
const inlineRefs = (node: JsonValue, defs: JsonObject): JsonValue => {
  if (Array.isArray(node)) return node.map((n) => inlineRefs(n, defs))
  if (node === null || typeof node !== 'object') return node

  const ref = node['$ref']
  if (typeof ref === 'string' && ref.includes('#/$defs/')) {
    const pointer = ref.slice(ref.indexOf('#/$defs/') + '#/$defs/'.length)
    let target: JsonValue = defs
    for (const segment of pointer.split('/').filter((p) => p.length > 0)) {
      target = asObject(target, ref)[segment] ?? null
      if (target === null) {
        throw new Error(`${ref}: points at an unknown $defs entry`)
      }
    }
    return inlineRefs(target, defs)
  }

  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, inlineRefs(value, defs)]),
  )
}

const stringList = (value: JsonValue | undefined, what: string): string[] => {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${what}: expected an array`)
  return value.map((v) => {
    if (typeof v !== 'string') throw new Error(`${what}: expected strings`)
    return v
  })
}

interface InputSchemaFacts {
  required: string[]
  properties: string[]
  additionalProperties: JsonValue | undefined
}

const inputSchemaFor = (agentId: string): InputSchemaFacts => {
  const meta = asObject(
    readJson(join(EXPERIMENTS, '_schema/manifest.schema.json')),
    'manifest.schema.json',
  )
  const defs = asObject(meta['$defs'] ?? {}, 'manifest.schema.json $defs')
  const manifest = asObject(
    readJson(join(EXPERIMENTS, agentId, 'manifest.json')),
    `${agentId}/manifest.json`,
  )
  const schema = asObject(
    inlineRefs(manifest['input_schema'] ?? null, defs),
    `${agentId} input_schema`,
  )
  return {
    required: stringList(schema['required'], `${agentId} required`),
    properties: Object.keys(
      asObject(schema['properties'] ?? {}, `${agentId} properties`),
    ),
    additionalProperties: schema['additionalProperties'],
  }
}

// The two manifests that accept params they do not declare. Which makes the
// undeclared-key check below matter MORE for them, not less: everywhere else a
// mistyped key is refused before a Fargate task launches, so it costs nothing;
// here it is accepted, the run is billed, and the param the case meant to set
// was never read.
const PERMITS_EXTRA_PARAMS: readonly string[] = [
  'opportunities_and_challenges',
  'opposition_research',
]

describe('the authored background case lists', () => {
  it('the registry points all fifteen at their own file', () => {
    expect(AUTHORED.map((id) => requireAgent(id).cases)).toEqual(
      AUTHORED.map((id) => `${id}.json`),
    )
  })

  it.each(AUTHORED)('%s parses through the real loader', (agentId) => {
    const agent = requireAgent(agentId)

    const list = loadCaseList(agent)
    expect(list.shape).toBe('background')

    const expectedCases = REAL_CASE_COUNTS[agentId]
    if (expectedCases !== undefined) {
      // Authored to test the agent, so it must NOT claim to be a placeholder
      // — that flag is what suppresses the report's "evidence the judge ran"
      // qualifier, and leaving it on would understate a real verdict exactly
      // as turning it off would overstate a synthetic one.
      expect(list.placeholder).toBe(false)
      expect(list.note).not.toContain('PLACEHOLDER')
      // The note is the only place a reader learns whose bench this is and
      // where it came from, since the params themselves are 400KB of capture.
      expect(list.note).toContain('chat-bench')
      expect(list.cases).toHaveLength(expectedCases)
      // The control is the one case kept out of the verdict, and every scored
      // probe carries the condition and dimensions the judge reads from this
      // list. Both are optional at load, so a missing one is silent and leaves
      // the judge blind on exactly the case that needed it.
      const cases = loadBackgroundCases(agent)
      expect(
        cases.filter((c) => c.scored === false).map((c) => c.caseId),
      ).toEqual(['control'])
      for (const one of cases.filter((c) => c.scored !== false)) {
        expect(one.condition, one.caseId).toBeTruthy()
        expect(caseDimensionsOf(one).length, one.caseId).toBeGreaterThan(0)
      }
    } else {
      // A verdict from a list nobody has dispatched is a claim about the
      // pipeline, not about the agent, and this flag is what carries that.
      expect(list.placeholder).toBe(true)
      expect(list.note).toContain('PLACEHOLDER')
      expect(list.cases).toHaveLength(CASES_PER_LIST)
    }

    // Ids name stored records, so a duplicate would overwrite rather than
    // add and the sweep would judge fewer cases than it was billed for.
    const ids = list.cases.map((c) => c.caseId)
    expect(new Set(ids).size).toBe(list.cases.length)

    const schema = inputSchemaFor(agentId)

    // Guards the check below against passing vacuously. district_issue_pulse's
    // whole input_schema is a bare $ref, so a reader that did not resolve it
    // would see no required properties and accept anything at all.
    expect(schema.required.length, `${agentId} input_schema`).toBeGreaterThan(0)

    // NOT a blanket `false`, which this file asserted while it covered only
    // the nine plain lists. Fourteen of the sixteen manifests do set it, but
    // the two research agents do not, so an undeclared key reaches THEM as a
    // param the agent silently ignores rather than as a refusal. Pinned
    // exactly, per agent, so a manifest flipping either way fails here naming
    // itself instead of quietly widening or narrowing what a case may carry.
    expect(schema.additionalProperties, `${agentId} input_schema`).toBe(
      PERMITS_EXTRA_PARAMS.includes(agentId),
    )

    // Narrowed by the loader rather than structurally here, so the shape the
    // parser already discriminated on is not re-derived per reader.
    for (const one of loadBackgroundCases(agent)) {
      const keys = Object.keys(one.params)
      expect(keys.length, one.caseId).toBeGreaterThan(0)

      // A missing required key is refused by the dispatch Lambda before a
      // Fargate task launches — so it costs nothing but also runs nothing, and
      // the sweep reports a case that never happened. An undeclared key is
      // refused the same way by every manifest but the two in
      // PERMITS_EXTRA_PARAMS, and is checked here for all of them regardless:
      // on those two it would otherwise be accepted and ignored.
      expect(
        schema.required.filter((r) => !keys.includes(r)),
        `${agentId}/${one.caseId} is missing required params`,
      ).toEqual([])
      expect(
        keys.filter((k) => !schema.properties.includes(k)),
        `${agentId}/${one.caseId} carries params the manifest does not declare`,
      ).toEqual([])
    }
  })
})

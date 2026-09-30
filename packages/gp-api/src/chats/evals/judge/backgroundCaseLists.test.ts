import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findAgent } from './agents'
import { loadCaseList } from './cases'
import { JsonValueSchema, type JsonValue } from './record'

// The registry-wide check that every named list is really on disk has to span
// both shapes, so it lives once, beside the chat lists, in
// chatCaseLists.test.ts.

// The nine background lists authored in one pass. Named here rather than
// derived from the registry, because deriving them would make this file agree
// with whatever the registry says — including a registry that lost one.
const AUTHORED = [
  'district_issue_pulse',
  'district_issue_snapshot',
  'meeting_briefing',
  'meeting_schedule',
  'opponent_research',
  'race_opponent_actions',
  'race_opponent_collection',
  'race_opponent_summary',
  'self_research',
] as const

// One baseline plus seven variations. Well under gates.minCases, which is
// deliberate and recorded in every list's `note`.
const CASES_PER_LIST = 8

// A background case's `params` is what the dispatch Lambda is called with, and
// the experiment manifest is the only statement of what that call accepts. The
// manifests live in another package, so this reaches across the repo on
// purpose: validating against a copy would only prove the copy.
//
// NOT a JSON Schema engine, and deliberately not: the monorepo declares no
// validator, and the two manifest facts that decide whether a dispatch is
// refused are `required` and `additionalProperties: false`. Types and patterns
// are left to the authored data being static.
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

describe('the authored background case lists', () => {
  it('the registry points all nine at their own file', () => {
    expect(AUTHORED.map((id) => findAgent(id)?.cases)).toEqual(
      AUTHORED.map((id) => `${id}.json`),
    )
  })

  it.each(AUTHORED)('%s parses through the real loader', (agentId) => {
    const agent = findAgent(agentId)
    if (agent === undefined) throw new Error(`${agentId} left the registry`)

    const list = loadCaseList(agent)
    expect(list.shape).toBe('background')
    // A verdict from a list nobody has dispatched is a claim about the
    // pipeline, not about the agent, and this flag is what carries that.
    expect(list.placeholder).toBe(true)
    expect(list.note).toContain('PLACEHOLDER')
    expect(list.cases).toHaveLength(CASES_PER_LIST)

    // Ids name stored records, so a duplicate would overwrite rather than
    // add and the sweep would judge fewer cases than it was billed for.
    const ids = list.cases.map((c) => c.caseId)
    expect(new Set(ids).size).toBe(CASES_PER_LIST)

    const schema = inputSchemaFor(agentId)

    // Guards the check below against passing vacuously. district_issue_pulse's
    // whole input_schema is a bare $ref, so a reader that did not resolve it
    // would see no required properties and accept anything at all.
    expect(schema.required.length, `${agentId} input_schema`).toBeGreaterThan(0)
    expect(schema.additionalProperties, `${agentId} input_schema`).toBe(false)

    for (const one of list.cases) {
      if (!('params' in one)) {
        throw new Error(`${agentId}/${one.caseId} carries no params`)
      }
      const keys = Object.keys(one.params)
      expect(keys.length, one.caseId).toBeGreaterThan(0)

      // A missing required key, or any key the manifest does not declare, is
      // refused by the dispatch Lambda before a Fargate task launches — so it
      // costs nothing but also runs nothing, and the sweep reports a case that
      // never happened.
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

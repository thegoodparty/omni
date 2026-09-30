import { describe, expect, it } from 'vitest'
import { findAgent } from './agents'
import { loadCaseList } from './cases'

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

    for (const one of list.cases) {
      if (!('params' in one)) {
        throw new Error(`${agentId}/${one.caseId} carries no params`)
      }
      expect(Object.keys(one.params).length, one.caseId).toBeGreaterThan(0)
    }
  })
})

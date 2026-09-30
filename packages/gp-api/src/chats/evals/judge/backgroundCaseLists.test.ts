import { existsSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AGENTS, findAgent } from './agents'
import { CASES_DIR, caseListPath, loadCaseList } from './cases'

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

// Registry entries that name a file, narrowed so the file name is a string.
const NAMED = AGENTS.flatMap((a) =>
  a.cases === null ? [] : [{ agentId: a.agentId, cases: a.cases }],
)

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

// Wiring data files by hand fails one way: the registry string and the file
// on disk drift apart. Checked against the directory rather than through the
// loader so the failure names a missing file instead of a read error.
describe('the case-list directory', () => {
  const files = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json'))

  // Without a floor, a directory that stopped matching would leave every
  // assertion below in a loop that never runs, and the suite would pass
  // having checked nothing.
  it('holds at least the ten lists the registry names', () => {
    expect(files.length).toBeGreaterThanOrEqual(AUTHORED.length + 1)
    expect(NAMED.length).toBe(AUTHORED.length + 1)
  })

  it.each(NAMED)('$agentId names a file that is really there', ({ cases }) => {
    expect(files, cases).toContain(cases)
    expect(existsSync(caseListPath(cases))).toBe(true)
  })
})

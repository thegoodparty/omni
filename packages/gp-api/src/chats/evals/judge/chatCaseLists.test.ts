import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENTS, findAgent, requireAgent } from './agents'
import { CASES_DIR, caseListPath, loadCaseList } from './cases'

// The four chat lists. Named here rather than derived from the registry,
// because deriving them would make this file agree with whatever the registry
// says — including a registry that lost one.
const AUTHORED = [
  'chief_of_staff',
  'campaign_assistant',
  'ordinance_flow',
  'priority_flow',
] as const

// The fifteen background lists contribute to the registry count below, but
// they are NOT named again here. backgroundCaseLists.test.ts names them and
// asserts their contents; a second copy of the same fifteen strings would add
// no independent check, only a second place to edit when a sixteenth is
// authored.
const AUTHORED_BACKGROUND_COUNT = 15

// One baseline plus seven single-axis variations. Well under gates.minCases,
// which is deliberate and recorded in every list's `note`.
const CASES_PER_LIST = 8

// briefing_annotation is blocked and has no handler, so it is deliberately
// out of the denominator. Asserted rather than assumed: a later change that
// quietly gave it a case list would be pointing inputs at a runner that
// cannot drive it.
const UNAUTHORED = 'briefing_annotation'

// Registry entries that name a file, narrowed so the file name is a string.
const NAMED = AGENTS.flatMap((a) =>
  a.cases === null ? [] : [{ agentId: a.agentId, cases: a.cases }],
)

describe('the authored chat case lists', () => {
  it('the registry points all four at their own file', () => {
    expect(AUTHORED.map((id) => findAgent(id)?.cases)).toEqual(
      AUTHORED.map((id) => `${id}.json`),
    )
  })

  it('leaves the blocked scope without inputs', () => {
    const blocked = findAgent(UNAUTHORED)
    expect(blocked?.status).toBe('blocked')
    expect(blocked?.cases).toBeNull()
  })

  it.each(AUTHORED)('%s parses through the real loader', (agentId) => {
    const list = loadCaseList(requireAgent(agentId))
    expect(list.shape).toBe('chat')
    // A verdict from a list nobody has driven a turn against is a claim about
    // the pipeline, not about the agent, and this flag is what carries that.
    expect(list.placeholder).toBe(true)
    expect(list.note).toContain('PLACEHOLDER')
    expect(list.cases).toHaveLength(CASES_PER_LIST)

    // Ids name stored records, so a duplicate would overwrite rather than
    // add and the sweep would judge fewer cases than it was billed for.
    // parseCaseList rejects one too; asserted here as well because this is
    // the file that would catch an authoring slip in a list it names.
    const ids = list.cases.map((c) => c.caseId)
    expect(new Set(ids).size).toBe(CASES_PER_LIST)

    for (const one of list.cases) {
      if (!('question' in one)) {
        throw new Error(`${agentId}/${one.caseId} carries no question`)
      }
      // A blank turn is an agent asked nothing, which reads downstream as a
      // case that ran rather than a case that was never written.
      expect(one.question.trim().length, one.caseId).toBeGreaterThan(0)
    }
  })
})

// Wiring data files by hand fails one way: the registry string and the file
// on disk drift apart. Checked against the directory rather than through the
// loader so the failure names a missing file instead of a read error. Spans
// BOTH shapes, because a check that covered only the lists its own file
// authored is the drift it exists to catch.
describe('the case-list directory', () => {
  const files = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json'))

  // Without a floor, a directory that stopped matching would leave every
  // assertion below in a loop that never runs, and the suite would pass
  // having checked nothing.
  it('holds every named list, and the registry names all 19', () => {
    expect(NAMED.length).toBeGreaterThan(0)
    expect(files.length).toBeGreaterThan(0)
    expect(NAMED.length).toBe(AUTHORED.length + AUTHORED_BACKGROUND_COUNT)
  })

  it.each(NAMED)('$agentId names a file that is really there', ({ cases }) => {
    expect(files, cases).toContain(cases)
    // Resolved as well as listed: `cases` is a registry string, and
    // caseListPath is what refuses one that would climb out of the directory.
    expect(caseListPath(cases)).toBe(join(CASES_DIR, cases))
  })
})

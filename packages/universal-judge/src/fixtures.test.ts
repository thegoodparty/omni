import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadCases } from './cases.js'

/**
 * The ordinance producer drafts from prior-step state the fixture carries. A
 * fixture holding nothing but a goal makes the agent ask a clarifying question
 * instead of drafting — correct behaviour, useless as a comparison, and it cost a
 * real run to discover. This pins the draftable set against the fixture files.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const RECORDS = join(
  HERE,
  '..',
  '..',
  'gp-api',
  'src',
  'chats',
  'general',
  'ordinance-flow',
  'evals',
  'fixtures',
  'records',
)

// authority and existingLaw are objects, not arrays — a length check on them
// silently passes as undefined and proves nothing.
type Record = {
  goalText?: string
  clarifyAnswers?: unknown[]
  authority?: { status?: string }
  existingLaw?: { text?: string }
}

const read = (fixture: string): Record =>
  JSON.parse(readFileSync(join(RECORDS, `${fixture}.json`), 'utf8'))

describe('ordinance_draft cases', () => {
  it('only names fixtures whose prior steps are populated enough to draft from', () => {
    for (const testCase of loadCases('ordinance_draft')) {
      const fixture = testCase.params.fixture as string
      const record = read(fixture)
      expect(
        record.clarifyAnswers?.length,
        `${fixture} has no clarify answers`,
      ).toBeTruthy()
      expect(
        record.authority?.status,
        `${fixture} has no authority finding`,
      ).toBeTruthy()
      expect(
        record.existingLaw?.text,
        `${fixture} has no current-law text`,
      ).toBeTruthy()
    }
  })

  it('names a fixture that actually exists on disk', () => {
    for (const testCase of loadCases('ordinance_draft')) {
      expect(() => read(testCase.params.fixture as string)).not.toThrow()
    }
  })

  it('excludes the goal-only fixtures that cannot draft', () => {
    // shade-trees carries only a goal; rent-cap-spokane and oil-spill-early stop
    // at clarify. Including any of them wastes a run on a clarifying question.
    const used = loadCases('ordinance_draft').map((c) => c.params.fixture)
    for (const fixture of [
      'shade-trees',
      'rent-cap-spokane',
      'oil-spill-early',
    ]) {
      expect(used, `${fixture} cannot reach the draft step`).not.toContain(
        fixture,
      )
    }
  })
})

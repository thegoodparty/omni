import { describe, expect, it } from 'vitest'
import { loadCases, slugFor } from './cases.js'
import { AGENTS } from './registry.js'

describe('loadCases', () => {
  it('loads every registered agent’s case file', () => {
    for (const agent of AGENTS) {
      const cases = loadCases(agent.name)
      expect(cases.length, `${agent.name} has no cases`).toBeGreaterThan(0)
    }
  })

  it('gives every case params the agent can actually be called with', () => {
    // Background agents are dispatched against a JSON Schema, so a case missing a
    // required field fails at dispatch time and wastes a run. Catch it here.
    const required: Record<string, string[]> = {
      find_existing_ordinances: ['state', 'office'],
      top_community_issues: ['state', 'office', 'district_descriptor'],
      meeting_briefing: ['officialName', 'state', 'meetingDate'],
    }
    for (const [agent, fields] of Object.entries(required)) {
      for (const testCase of loadCases(agent)) {
        for (const field of fields) {
          expect(
            testCase.params[field],
            `${agent}/${testCase.id} is missing ${field}`,
          ).toBeTruthy()
        }
      }
    }
  })

  it('does not commit a real organization slug — the runner injects one', () => {
    for (const agent of AGENTS) {
      for (const testCase of loadCases(agent.name)) {
        expect(testCase.params.organization_slug).toBeUndefined()
      }
    }
  })

  it('respects the limit', () => {
    expect(loadCases('find_existing_ordinances', 2)).toHaveLength(2)
  })

  it('explains itself when an agent has no case file', () => {
    expect(() => loadCases('not_an_agent')).toThrow(/no golden cases/)
  })
})

describe('slugFor', () => {
  it('produces a slug the dispatcher will accept', () => {
    const slug = slugFor('top_community_issues', 'chicago_ward', 'pr_1234')
    expect(slug).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
  })

  it('separates the two variants of the same case', () => {
    const baseline = slugFor('meeting_briefing', 'cheyenne_council', 'main')
    const candidate = slugFor('meeting_briefing', 'cheyenne_council', 'pr_1234')
    expect(baseline).not.toBe(candidate)
  })

  it('stays inside the 64-character limit for long inputs', () => {
    const slug = slugFor(
      'find_existing_ordinances',
      'a_very_long_case_identifier_here',
      'a'.repeat(40),
    )
    expect(slug.length).toBeLessThanOrEqual(64)
    expect(slug).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
  })

  it('strips characters a ref might carry that the dispatcher rejects', () => {
    const slug = slugFor('meeting_briefing', 'case_one', 'feature/some-branch')
    expect(slug).toMatch(/^[a-zA-Z0-9_-]+$/)
  })
})

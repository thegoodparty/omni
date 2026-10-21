import { describe, expect, it } from 'vitest'
import { humanizeToolName, resolveToolLabel } from './toolLabels'

describe('humanizeToolName', () => {
  // The case that put `campaign_story` on a pill in front of a candidate.
  it('turns a snake_case tool name into sentence case', () => {
    expect(humanizeToolName('campaign_story')).toBe('Campaign story')
  })

  it.each([
    ['get_ballot_requirements', 'Get ballot requirements'],
    ['read_community_issues', 'Read community issues'],
    ['present_outreach_proposal', 'Present outreach proposal'],
  ])('humanizes %s', (toolName: string, expected: string) => {
    expect(humanizeToolName(toolName)).toBe(expected)
  })

  it('handles kebab-case and repeated separators', () => {
    expect(humanizeToolName('save__existing-law')).toBe('Save existing law')
  })

  it('returns an empty string for an empty name rather than throwing', () => {
    expect(humanizeToolName('')).toBe('')
  })
})

describe('resolveToolLabel', () => {
  // The guarantee: a tool nobody listed still reads as words.
  it('never returns a raw machine name for an unknown tool', () => {
    const label = resolveToolLabel('some_brand_new_tool')
    expect(label).toBe('Some brand new tool')
    expect(label).not.toContain('_')
  })

  it('prefers a surface override over everything', () => {
    expect(
      resolveToolLabel('campaign_story', { campaign_story: 'Your story' }),
    ).toBe('Your story')
  })

  // Internal acronyms and vendor names cannot fix themselves.
  it.each([
    ['crud_priorities', 'Priorities'],
    ['brave_search', 'Web search'],
    ['web_search', 'Web search'],
  ])('uses the built-in override for %s', (toolName: string, expected) => {
    expect(resolveToolLabel(toolName)).toBe(expected)
  })

  it('falls back past an override map that does not list the tool', () => {
    expect(
      resolveToolLabel('campaign_story', { web_search: 'Searching' }),
    ).toBe('Campaign story')
  })
})

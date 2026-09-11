import { describe, expect, it } from 'vitest'
import { toolDisplayName, toolStatusLabel } from './chatConstants'

describe('toolDisplayName', () => {
  it('gives every tool the agent can call a human label', () => {
    expect(toolDisplayName('read_community_issues')).toBe(
      'Reading community issues',
    )
    expect(toolDisplayName('count_contacts')).toBe('Counting your contacts')
  })

  it('never shows a raw identifier for a tool nobody mapped', () => {
    // The failure this replaces: an unmapped tool printed
    // "read_community_issues" at the user, mid-conversation.
    const label = toolDisplayName('some_new_tool')
    expect(label).toBe('Some new tool')
    expect(label).not.toContain('_')
  })
})

describe('toolStatusLabel', () => {
  it('labels crud_priorities by its action', () => {
    expect(toolStatusLabel('crud_priorities', 'list')).toBe(
      'Reading your priorities',
    )
    expect(toolStatusLabel('crud_priorities', 'create')).toBe(
      'Saving your priorities',
    )
    expect(toolStatusLabel('crud_priorities', 'update')).toBe(
      'Updating your priorities',
    )
    expect(toolStatusLabel('crud_priorities', 'archive')).toBe(
      'Removing a priority',
    )
  })

  it('falls back to the base name without (or for an unknown) action', () => {
    expect(toolStatusLabel('crud_priorities')).toBe(
      toolDisplayName('crud_priorities'),
    )
    expect(toolStatusLabel('crud_priorities', 'bogus')).toBe(
      toolDisplayName('crud_priorities'),
    )
  })

  it('ignores action for tools that have no per-action labels', () => {
    expect(toolStatusLabel('web_search', 'create')).toBe('Searching the web')
  })
})

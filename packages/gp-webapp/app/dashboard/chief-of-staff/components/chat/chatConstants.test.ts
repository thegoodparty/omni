import { describe, expect, it } from 'vitest'
import { toolDisplayName, toolStatusLabel } from './chatConstants'

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

  // An unlabelled tool shows its raw name to an elected official — and this
  // list is hand-maintained against a tool set that lives in gp-api, so it
  // does not catch a new tool until someone adds it here. `list_precincts`
  // shipped to preview reading "list_precincts" on screen for exactly that
  // reason. Add the tool here in the same change that registers it.
  it('labels every tool the chief-of-staff scope can register', () => {
    for (const name of [
      'web_search',
      'crud_priorities',
      'list_briefings',
      'get_briefing',
      'query_constituent_data',
      'describe_constituent_data',
      'read_community_issues',
      'describe_filter_dimensions',
      'count_contacts',
      'list_precincts',
      'crud_saved_filters',
    ]) {
      expect(toolDisplayName(name)).not.toBe(name)
    }
  })
})

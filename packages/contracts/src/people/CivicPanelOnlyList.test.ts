import { describe, expect, it } from 'vitest'
import { isCivicPanelOnlyList } from './CivicPanelOnlyList'

describe('isCivicPanelOnlyList', () => {
  it.each([
    [{ civicPanelMember: true }],
    [{ civicPanelMember: true, notContactedRecently: true }],
    [{ civicPanelJoinedByText: true }],
    [{ civicPanelJoinedFrom: '2026-10-01' }],
    [
      {
        civicPanelMember: true,
        civicPanelLeft: true,
        civicPanelJoinedTo: '2026-10-09',
      },
    ],
  ])('reads %j as the panel only', (list) => {
    expect(isCivicPanelOnlyList(list)).toBe(true)
  })

  it.each([
    [{}],
    [{ civicPanelMember: false }],
    [{ civicPanelMember: true, civicPanelLeft: true }],
    [{ civicPanelMember: true, civicPanelNeverInvited: true }],
    [{ civicPanelLeft: true }],
    [{ civicPanelMember: null, civicPanelJoinedFrom: '' }],
  ])('reads %j as reaching beyond the panel', (list) => {
    expect(isCivicPanelOnlyList(list)).toBe(false)
  })
})

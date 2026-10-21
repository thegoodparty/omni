import { describe, expect, it } from 'vitest'
import {
  civicPanelFreshnessText,
  civicPanelStandingLine,
} from './CivicPanelBuildPlan.schema'

describe('civicPanelStandingLine', () => {
  it('says where the panel stands in groups', () => {
    expect(
      civicPanelStandingLine({
        members: 62,
        groupsCovered: 9,
        groupsTotal: 12,
      }),
    ).toBe('62 members so far, from 9 of 12 groups in your district.')
  })

  it('leaves the groups out when the district could not be read', () => {
    expect(
      civicPanelStandingLine({ members: 1, groupsCovered: 0, groupsTotal: 0 }),
    ).toBe('1 member so far.')
  })

  it('judges a panel past its goal on fresh voices', () => {
    const progress = { members: 250, groupsCovered: 12, groupsTotal: 12 }
    expect(civicPanelStandingLine(progress, { groupsNeedingFresh: 3 })).toBe(
      '250 members. 3 groups need fresh voices.',
    )
    expect(civicPanelStandingLine(progress, { groupsNeedingFresh: 0 })).toBe(
      '250 members. Every group has fresh voices.',
    )
  })

  it('keeps the members-so-far line before the goal', () => {
    expect(
      civicPanelStandingLine(
        { members: 62, groupsCovered: 9, groupsTotal: 12 },
        {},
      ),
    ).toBe('62 members so far, from 9 of 12 groups in your district.')
  })
})

describe('civicPanelFreshnessText', () => {
  it('counts the groups short of active members', () => {
    expect(civicPanelFreshnessText(1)).toBe('1 group needs fresh voices')
    expect(civicPanelFreshnessText(4)).toBe('4 groups need fresh voices')
    expect(civicPanelFreshnessText(0)).toBe('Every group has fresh voices')
  })
})

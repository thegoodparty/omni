import { describe, expect, it } from 'vitest'
import { civicPanelStandingLine } from './CivicPanelBuildPlan.schema'

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
})

import { describe, expect, it } from 'vitest'
import {
  civicPanelFreshnessText,
  civicPanelOpenStepDetail,
  civicPanelStandingLine,
  civicPanelStepAction,
  civicPanelStepTitle,
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

describe('the words for a plan step', () => {
  const step = {
    channel: 'phone_banking' as const,
    position: 1,
    targetSize: 60,
    status: 'not_started' as const,
    reached: null,
    steeredToward: null,
    landlineFirst: true,
  }

  it('names who to reach, then who they are and how long it takes', () => {
    expect(civicPanelStepTitle(step)).toBe('Call 60 residents')
    expect(civicPanelOpenStepDetail(step)).toBe(
      "People a text can't reach, landlines first. About 4 hours of your time.",
    )
    expect(civicPanelStepAction(step)).toBe('Start the calls')
  })

  it('says how far a call list underway has got', () => {
    const calling = { ...step, status: 'in_progress' as const, reached: 12 }
    expect(civicPanelOpenStepDetail(calling)).toBe('Called 12 so far.')
    expect(civicPanelStepAction(calling)).toBe('Keep calling')
  })

  it('reads a text by its size, with nothing to press once it is on its way', () => {
    const text = { ...step, channel: 'text' as const, targetSize: 8334 }
    expect(civicPanelStepTitle(text)).toBe('Text 8,334 residents')
    expect(civicPanelOpenStepDetail(text)).toBe(
      'Residents with a cell phone, from every part of your district.',
    )
    expect(civicPanelStepAction({ ...text, status: 'in_progress' })).toBeNull()
  })

  it('names a second walkable area', () => {
    expect(
      civicPanelStepTitle({
        channel: 'door_knocking',
        position: 2,
        targetSize: 100,
      }),
    ).toBe('Knock on 100 doors in a second walkable area')
  })
})

import { describe, expect, it } from 'vitest'
import type { CivicPanelBuildPlanResponse } from '@goodparty_org/contracts'
import { civicPanelBuildCardContent } from '../services/dashboardCards.service'

const panel = (
  balance: CivicPanelBuildPlanResponse['balance'],
  members: number,
): CivicPanelBuildPlanResponse => ({
  plan: {
    id: 'plan-1',
    status: 'active',
    goalMembers: 250,
    keepFresh: members >= 250,
    hoursPerWeek: 2,
    currentWave: 1,
    createdAt: new Date('2026-10-20T12:00:00Z'),
    completedAt: null,
    steps: [],
  },
  next: {
    stepId: 'step-1',
    channel: 'phone_banking',
    status: 'not_started',
    line: 'Call 30 residents',
    href: '/dashboard/contacts/citizens-panel?step=step-1',
  },
  progress: {
    members,
    goal: 250,
    answersNeeded: 100,
    expectedAnswers: 100,
    groupsCovered: 12,
    groupsTotal: 12,
  },
  balance,
})

describe('civicPanelBuildCardContent', () => {
  it('says where the panel stands in groups before its goal', () => {
    const card = civicPanelBuildCardContent(
      panel({ status: 'missingGroups', inviteMore: 'age65plus' }, 62),
    )

    expect(card.summary).toBe(
      '62 members so far, from 12 of 12 groups in your district.',
    )
  })

  it('says how many groups need fresh voices past the goal', () => {
    const card = civicPanelBuildCardContent(
      panel(
        {
          status: 'everyGroup',
          inviteMore: 'age65plus',
          groupsNeedingFresh: 3,
        },
        250,
      ),
    )

    expect(card.summary).toBe('250 members. 3 groups need fresh voices.')
  })

  it('says so once every group has fresh voices', () => {
    const card = civicPanelBuildCardContent(
      panel(
        { status: 'everyGroup', inviteMore: null, groupsNeedingFresh: 0 },
        250,
      ),
    )

    expect(card.summary).toBe('250 members. Every group has fresh voices.')
  })
})

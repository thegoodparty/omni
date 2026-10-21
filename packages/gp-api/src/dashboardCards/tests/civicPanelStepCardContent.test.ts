import { describe, expect, it } from 'vitest'
import type {
  CivicPanelBuildNext,
  CivicPanelBuildPlanResponse,
  CivicPanelBuildStep,
} from '@goodparty_org/contracts'
import { civicPanelStepCardContent } from '../services/dashboardCards.service'

const step = (
  overrides: Partial<CivicPanelBuildStep>,
): CivicPanelBuildStep => ({
  id: 'step-1',
  wave: 1,
  channel: 'phone_banking',
  position: 1,
  targetSize: 60,
  status: 'not_started',
  voterFileFilterId: null,
  outreachId: null,
  phoneBankingListId: null,
  doorKnockingTurfId: null,
  startedAt: null,
  completedAt: null,
  expectedRepliesBy: null,
  markedDone: null,
  reached: null,
  joined: null,
  steeredToward: null,
  landlineFirst: true,
  ...overrides,
})

const panel = (
  steps: CivicPanelBuildStep[],
  next: Partial<CivicPanelBuildNext> = {},
): CivicPanelBuildPlanResponse => ({
  plan: {
    id: 'plan-1',
    status: 'active',
    goalMembers: 250,
    keepFresh: false,
    hoursPerWeek: 2,
    currentWave: 1,
    createdAt: new Date('2026-10-20T12:00:00Z'),
    completedAt: null,
    steps,
  },
  next: {
    stepId: 'step-1',
    channel: 'phone_banking',
    status: 'not_started',
    line: 'Call residents to invite them to your civic panel',
    href: '/dashboard/contacts/citizens-panel?step=step-1',
    ...next,
  },
  progress: {
    members: 0,
    goal: 250,
    answersNeeded: 100,
    expectedAnswers: 0,
    groupsCovered: 0,
    groupsTotal: 12,
  },
  balance: { status: 'tooFewMembers', inviteMore: null },
})

describe('civicPanelStepCardContent', () => {
  it('says the one next step, who it reaches and how long it takes', () => {
    expect(civicPanelStepCardContent(panel([step({})]))).toEqual({
      title: 'Call 60 residents',
      summary:
        "People a text can't reach, landlines first. About 4 hours of your time.",
      ctaLabel: 'Start the calls',
      ctaHref: '/dashboard/contacts/citizens-panel?step=step-1',
    })
  })

  it('keeps the official going on a walk underway', () => {
    const card = civicPanelStepCardContent(
      panel(
        [
          step({
            channel: 'door_knocking',
            targetSize: 100,
            status: 'in_progress',
            reached: 40,
          }),
        ],
        { channel: 'door_knocking', status: 'in_progress' },
      ),
    )

    expect(card).toMatchObject({
      title: 'Knock on 100 doors in a walkable area',
      summary: 'Visited 40 residents so far.',
      ctaLabel: 'Keep knocking',
    })
  })

  it('has no card while the plan waits on replies', () => {
    expect(
      civicPanelStepCardContent(
        panel([step({ channel: 'text', status: 'waiting_on_replies' })], {
          channel: 'text',
          status: 'waiting_on_replies',
          href: null,
        }),
      ),
    ).toBeNull()
  })
})

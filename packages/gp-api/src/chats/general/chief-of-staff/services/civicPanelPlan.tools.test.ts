import { describe, expect, it, vi } from 'vitest'
import { ConflictException, NotFoundException } from '@nestjs/common'
import type { CivicPanelBuildPlanResponse } from '@goodparty_org/contracts'
import type { Organization } from '../../../../generated/prisma'
import type { CivicPanelBuildPlanService } from '@/contacts/services/civicPanelBuildPlan.service'
import { buildCivicPanelPlanTools } from './civicPanelPlan.tools'

const organization = { slug: 'eo-1' } as Organization

const NO_PLAN: CivicPanelBuildPlanResponse = {
  plan: null,
  next: null,
  progress: { members: 4, goal: 240, answersNeeded: 96, expectedAnswers: 2 },
  balance: null,
}

const withPlan = (hoursPerWeek: number): CivicPanelBuildPlanResponse => ({
  plan: {
    id: 'plan-1',
    status: 'active',
    goalMembers: 100,
    hoursPerWeek,
    currentWave: 1,
    createdAt: new Date('2026-10-15T00:00:00Z'),
    completedAt: null,
    steps: [],
  },
  next: {
    stepId: 'step-1',
    channel: 'text',
    status: 'not_started',
    line: 'Invite residents to your civic panel by text',
    href: '/dashboard/contacts/citizens-panel?step=step-1',
  },
  progress: { members: 4, goal: 240, answersNeeded: 96, expectedAnswers: 2 },
  balance: { status: 'notYetRepresentative', inviteMore: 'age65plus' },
})

const buildPlans = (overrides: Partial<CivicPanelBuildPlanService> = {}) =>
  ({
    create: vi.fn((_org: Organization, hours: number) =>
      Promise.resolve(withPlan(hours)),
    ),
    updateHours: vi.fn((_org: Organization, hours: number) =>
      Promise.resolve(withPlan(hours)),
    ),
    read: vi.fn(() => Promise.resolve(NO_PLAN)),
    ...overrides,
  }) as unknown as CivicPanelBuildPlanService

const toolsFor = (plans: CivicPanelBuildPlanService, hasPlan: boolean) =>
  buildCivicPanelPlanTools({ plans, organization, hasPlan })

describe('the civic panel plan tools', () => {
  it('asks the weekly time question only while there is no plan', async () => {
    const plans = buildPlans()
    expect(
      await toolsFor(plans, false).ask_panel_weekly_time.execute({}),
    ).toEqual({ asked: true })
    expect(
      await toolsFor(plans, true).ask_panel_weekly_time.execute({}),
    ).toHaveProperty('error', expect.stringContaining('Never ask the weekly'))
  })

  it('makes the plan on the first answer, the same as the panel page', async () => {
    const plans = buildPlans()
    const tools = toolsFor(plans, false)

    const result = await tools.save_panel_weekly_time.execute({
      hoursPerWeek: 2,
    })

    expect(plans.create).toHaveBeenCalledWith(organization, 2, 'chief_of_staff')
    expect(plans.updateHours).not.toHaveBeenCalled()
    expect(result).toEqual({
      saved: 'created',
      members: 4,
      goal: 240,
      answersNeeded: 96,
      expectedAnswers: 2,
      hoursPerWeek: 2,
      next: 'Invite residents to your civic panel by text',
      panelStatus: 'Not yet representative',
      inviteMoreNext: 'people 65 and over',
    })
    // Answered once, it is never asked again in the same turn.
    expect(await tools.ask_panel_weekly_time.execute({})).toHaveProperty(
      'error',
    )
  })

  it('changes the weekly time of a plan that exists, never making a second', async () => {
    const plans = buildPlans()

    const result = await toolsFor(plans, true).save_panel_weekly_time.execute({
      hoursPerWeek: 3,
    })

    expect(plans.updateHours).toHaveBeenCalledWith(
      organization,
      3,
      'chief_of_staff',
    )
    expect(plans.create).not.toHaveBeenCalled()
    expect(result).toMatchObject({ saved: 'updated', hoursPerWeek: 3 })
  })

  it('changes the plan made on the panel page meanwhile', async () => {
    const plans = buildPlans({
      create: vi.fn(() =>
        Promise.reject(
          new ConflictException('This office already has a panel plan'),
        ),
      ),
      read: vi.fn(() => Promise.resolve(withPlan(1))),
    })

    const result = await toolsFor(plans, false).save_panel_weekly_time.execute({
      hoursPerWeek: 4,
    })

    expect(plans.updateHours).toHaveBeenCalledWith(
      organization,
      4,
      'chief_of_staff',
    )
    expect(result).toMatchObject({ saved: 'updated', hoursPerWeek: 4 })
  })

  it('makes a new plan once the old one ended', async () => {
    const plans = buildPlans({
      updateHours: vi.fn(() =>
        Promise.reject(
          new NotFoundException('This office has no panel plan to change'),
        ),
      ),
    })

    const result = await toolsFor(plans, true).save_panel_weekly_time.execute({
      hoursPerWeek: 2,
    })

    expect(plans.create).toHaveBeenCalledWith(organization, 2, 'chief_of_staff')
    expect(result).toMatchObject({ saved: 'created' })
  })

  it('says why when no plan can be made, and points at the panel page', async () => {
    const plans = buildPlans({
      create: vi.fn(() =>
        Promise.reject(
          new ConflictException(
            'Everyone we can reach has already been invited',
          ),
        ),
      ),
    })

    const result = await toolsFor(plans, false).save_panel_weekly_time.execute({
      hoursPerWeek: 1,
    })

    expect(result).toEqual({
      planMade: false,
      reason: 'Everyone we can reach has already been invited',
      panelPage: '/dashboard/contacts/citizens-panel',
    })
    expect(plans.updateHours).not.toHaveBeenCalled()
  })

  it('lets any other failure through', async () => {
    const plans = buildPlans({
      create: vi.fn(() => Promise.reject(new Error('people db down'))),
    })
    await expect(
      toolsFor(plans, false).save_panel_weekly_time.execute({
        hoursPerWeek: 1,
      }),
    ).rejects.toThrow('people db down')
  })

  it('refuses less than an hour a week, and more than the page allows', () => {
    const { inputSchema } = toolsFor(buildPlans(), false).save_panel_weekly_time
    expect(inputSchema.safeParse({ hoursPerWeek: 0 }).success).toBe(false)
    expect(inputSchema.safeParse({ hoursPerWeek: 21 }).success).toBe(false)
    expect(inputSchema.safeParse({ hoursPerWeek: 20 }).success).toBe(true)
  })

  it("shows the plan's next step, and refuses before there is a plan", async () => {
    expect(
      await toolsFor(buildPlans(), false).present_panel_next_step.execute({}),
    ).toHaveProperty('error', expect.stringContaining('ask_panel_weekly_time'))

    const plans = buildPlans({
      read: vi.fn(() => Promise.resolve(withPlan(2))),
    })
    expect(
      await toolsFor(plans, true).present_panel_next_step.execute({}),
    ).toEqual({
      shown: true,
      members: 4,
      goal: 240,
      answersNeeded: 96,
      expectedAnswers: 2,
      hoursPerWeek: 2,
      next: 'Invite residents to your civic panel by text',
      panelStatus: 'Not yet representative',
      inviteMoreNext: 'people 65 and over',
    })
  })
})

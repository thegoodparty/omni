import { HttpException } from '@nestjs/common'
import { z } from 'zod'
import {
  CIVIC_PANEL_PAGE_HREF,
  civicPanelFreshnessText,
  civicPanelStandingLine,
  PANEL_MAX_HOURS_PER_WEEK,
  PANEL_MIN_HOURS_PER_WEEK,
  CIVIC_PANEL_BALANCE_STATUS_LABELS,
  UNDERREPRESENTED_GROUP_NAMES,
  type CivicPanelBuildPlanResponse,
} from '@goodparty_org/contracts'
import type { Organization } from '../../../../generated/prisma'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type { CivicPanelBuildPlanService } from '@/contacts/services/civicPanelBuildPlan.service'

export const ASK_PANEL_WEEKLY_TIME_TOOL = 'ask_panel_weekly_time'
export const SAVE_PANEL_WEEKLY_TIME_TOOL = 'save_panel_weekly_time'
export const PRESENT_PANEL_NEXT_STEP_TOOL = 'present_panel_next_step'

// The Chief of Staff builds the panel on the same plan as the panel page
// (`CivicPanelBuildPlanService`), so the two can never disagree. The weekly
// time question and the next step are widgets the app draws from fixed words;
// these tools only decide whether they may be shown and write the answer.

const noInput = z.object({})

const saveInput = z.object({
  hoursPerWeek: z
    .number()
    .int()
    .min(
      PANEL_MIN_HOURS_PER_WEEK,
      'A plan needs at least an hour a week. Say so and ask the weekly ' +
        'time question again.',
    )
    .max(PANEL_MAX_HOURS_PER_WEEK)
    .describe(
      'The hours they can give each week: 1, 2 or 3 for those answers, 4 ' +
        `for "4 or more hours a week", or the number they wrote (at most ` +
        `${PANEL_MAX_HOURS_PER_WEEK}).`,
    ),
})

// What the model needs to say where things stand, in the panel page's words.
const standing = (panel: CivicPanelBuildPlanResponse) => ({
  members: panel.progress.members,
  groupsCovered: panel.progress.groupsCovered,
  groupsTotal: panel.progress.groupsTotal,
  standing: civicPanelStandingLine(panel.progress, panel.balance),
  hoursPerWeek: panel.plan?.hoursPerWeek ?? null,
  next: panel.next?.line ?? null,
  // The panel page's status label and the group it says to invite next,
  // in its words. Null when the census could not be compared.
  panelStatus: panel.balance
    ? CIVIC_PANEL_BALANCE_STATUS_LABELS[panel.balance.status]
    : null,
  // Past its goal: how many groups have no active members, in the panel
  // page's words. Null before the goal.
  freshVoices:
    panel.balance?.groupsNeedingFresh != null
      ? civicPanelFreshnessText(panel.balance.groupsNeedingFresh)
      : null,
  inviteMoreNext: panel.balance?.inviteMore
    ? UNDERREPRESENTED_GROUP_NAMES[panel.balance.inviteMore]
    : null,
})

const isStatus = (error: unknown, status: number): boolean =>
  error instanceof HttpException && error.getStatus() === status

const hasActivePlan = (panel: CivicPanelBuildPlanResponse): boolean =>
  panel.plan?.status === 'active'

export const buildCivicPanelPlanTools = ({
  plans,
  organization,
  hasPlan,
}: {
  plans: CivicPanelBuildPlanService
  organization: Organization
  // Whether the office had a plan when the turn started.
  hasPlan: boolean
}) => {
  // A plan made earlier in this turn counts too, so the question is never
  // asked again once it is answered.
  let planMade = hasPlan

  const ask: LlmStreamTool<typeof noInput> = {
    description:
      'Ask how much time the official can give their civic panel each ' +
      'week. The app shows the question with its answers (1, 2, 3, or 4 or ' +
      'more hours a week), so never write the question or the answers as ' +
      'chat text. Only when they have no plan yet.',
    inputSchema: noInput,
    execute: () =>
      planMade
        ? {
            error:
              'They already have a plan. Never ask the weekly time question ' +
              `again. Call ${PRESENT_PANEL_NEXT_STEP_TOOL} to show where ` +
              'it stands.',
          }
        : { asked: true },
  }

  const save: LlmStreamTool<typeof saveInput> = {
    description:
      'Save the hours the official can give each week. With no plan yet it ' +
      'makes their panel plan, the same plan their panel page shows; with ' +
      'one, it changes the time the next batch of invites is sized from. ' +
      'Returns where the panel stands, or planMade false with the reason ' +
      'when no plan could be made.',
    inputSchema: saveInput,
    execute: async ({ hoursPerWeek }) => {
      const update = async () => ({
        saved: 'updated',
        ...standing(
          await plans.updateHours(organization, hoursPerWeek, 'chief_of_staff'),
        ),
      })
      if (planMade) {
        try {
          return await update()
        } catch (error) {
          // The plan ended since (its goal, or nobody left): make a new one.
          if (!isStatus(error, 404)) throw error
        }
      }
      try {
        const panel = await plans.create(
          organization,
          hoursPerWeek,
          'chief_of_staff',
        )
        planMade = true
        return { saved: 'created', ...standing(panel) }
      } catch (error) {
        if (!(error instanceof HttpException) || error.getStatus() !== 409) {
          throw error
        }
        // Made on the panel page meanwhile: the answer changes that plan.
        if (hasActivePlan(await plans.read(organization))) {
          planMade = true
          return update()
        }
        return {
          planMade: false,
          reason: error.message,
          panelPage: CIVIC_PANEL_PAGE_HREF,
        }
      }
    },
  }

  const present: LlmStreamTool<typeof noInput> = {
    description:
      "Show the panel plan's next step as a card: the panel page's status " +
      'and group to invite next, its Next line, how many members of the ' +
      'goal, and a button that opens that step. The card reads the plan ' +
      'itself, so never restate it. Returns what it shows.',
    inputSchema: noInput,
    execute: async () => {
      const panel = await plans.read(organization)
      if (!hasActivePlan(panel)) {
        return {
          error:
            'They have no plan yet. Ask the weekly time question with ' +
            `${ASK_PANEL_WEEKLY_TIME_TOOL} first.`,
        }
      }
      planMade = true
      return { shown: true, ...standing(panel) }
    },
  }

  return {
    [ASK_PANEL_WEEKLY_TIME_TOOL]: ask,
    [SAVE_PANEL_WEEKLY_TIME_TOOL]: save,
    [PRESENT_PANEL_NEXT_STEP_TOOL]: present,
  }
}

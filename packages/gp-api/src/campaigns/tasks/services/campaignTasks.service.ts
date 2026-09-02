import {
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Campaign, Prisma } from '../../../generated/prisma'
import {
  differenceInCalendarDays,
  differenceInWeeks,
  isAfter,
  isBefore,
  isValid,
  startOfDay,
  startOfWeek,
  subWeeks,
} from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { isTestCampaign } from '@/users/util/users.util'
import {
  DateFormats,
  formatDate,
  parseIsoDateString,
} from 'src/shared/util/date.util'
import { sleep } from 'src/shared/util/sleep.util'
import { WrapperType } from 'src/shared/types/utility.types'
import { SlackService } from 'src/vendors/slack/services/slack.service'
import {
  SlackChannel,
  SlackMessageType,
} from 'src/vendors/slack/slackService.types'
import { CampaignTask, CampaignTaskType } from '../campaignTasks.types'
import { CompleteTaskBodySchema } from '../schemas/completeTaskBody.schema'
import { CampaignsService } from '../../services/campaigns.service'
import { CampaignTrackerTasksService } from '../../campaignTracker/services/campaignTrackerTasks.service'

import { VOTER_GOALS_ADVISORY_LOCK_KEY } from '../../campaigns.consts'

const SLACK_RETRY_BASE_DELAY_MS = 500

@Injectable()
export class CampaignTasksService extends createPrismaBase(
  MODELS.CampaignTask,
) {
  constructor(
    private readonly slackService: SlackService,
    @Inject(forwardRef(() => CampaignsService))
    private readonly campaignsService: WrapperType<CampaignsService>,
    private readonly trackerTasks: CampaignTrackerTasksService,
  ) {
    super()
  }

  async nonDefaultTasksExist(campaignId: number): Promise<boolean> {
    const count = await this.model.count({
      where: { campaignId, NOT: { isDefaultTask: true } },
    })
    return count > 0
  }

  async listCampaignTasks({ id: campaignId }: Campaign) {
    const where: Prisma.CampaignTaskWhereInput = { campaignId }

    return this.model.findMany({
      where,
      orderBy: [
        { week: Prisma.SortOrder.desc },
        { date: Prisma.SortOrder.asc },
        { id: Prisma.SortOrder.asc },
      ],
    })
  }

  async getCampaignTaskById(campaignId: number, id: string) {
    return this.model.findFirst({
      where: {
        campaignId,
        id,
      },
    })
  }

  async completeTask(
    { id: campaignId, userId }: Campaign,
    id: string,
    voterContact?: CompleteTaskBodySchema,
  ) {
    return this.client.$transaction(async (tx) => {
      if (voterContact) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${VOTER_GOALS_ADVISORY_LOCK_KEY}::integer, ${campaignId}::integer)`
      }

      const task = await tx.campaignTask.findFirst({
        where: { campaignId, id },
      })
      if (!task) {
        throw new NotFoundException(`Task ${id} not found`)
      }
      if (task.completed) {
        return task
      }

      let updateHistoryId: number | undefined

      if (voterContact) {
        const history = await tx.campaignUpdateHistory.create({
          data: {
            type: voterContact.type,
            quantity: voterContact.quantity,
            campaignId,
            userId,
          },
        })
        updateHistoryId = history.id

        const campaign = await tx.campaign.findUniqueOrThrow({
          where: { id: campaignId },
        })
        const { data } = campaign
        const reportedVoterGoals = (data.reportedVoterGoals || {}) as Record<
          string,
          number
        >
        reportedVoterGoals[voterContact.type] =
          (reportedVoterGoals[voterContact.type] || 0) + voterContact.quantity
        data.reportedVoterGoals = { ...reportedVoterGoals }

        await tx.campaign.update({
          where: { id: campaignId },
          data: { data },
        })
      }

      return tx.campaignTask.update({
        where: { id: task.id },
        data: {
          completed: true,
          ...(updateHistoryId !== undefined && { updateHistoryId }),
        },
      })
    })
  }

  async unCompleteTask({ id: campaignId }: Campaign, id: string) {
    return this.client.$transaction(async (tx) => {
      const task = await tx.campaignTask.findFirst({
        where: { campaignId, id },
      })
      if (!task) {
        throw new NotFoundException(`Task ${id} not found`)
      }
      if (!task.completed) {
        return task
      }

      const history = task.updateHistoryId
        ? await tx.campaignUpdateHistory.findUniqueOrThrow({
            where: { id: task.updateHistoryId },
            select: { id: true, type: true, quantity: true },
          })
        : null

      if (history) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${VOTER_GOALS_ADVISORY_LOCK_KEY}::integer, ${campaignId}::integer)`
        const campaign = await tx.campaign.findUniqueOrThrow({
          where: { id: campaignId },
        })
        const { data } = campaign
        const reportedVoterGoals = (data.reportedVoterGoals || {}) as Record<
          string,
          number
        >
        reportedVoterGoals[history.type] = Math.max(
          (reportedVoterGoals[history.type] || 0) - history.quantity,
          0,
        )
        data.reportedVoterGoals = { ...reportedVoterGoals }

        await tx.campaign.update({
          where: { id: campaignId },
          data: { data },
        })

        await tx.campaignUpdateHistory.delete({
          where: { id: history.id },
        })
      }

      return tx.campaignTask.update({
        where: { id: task.id },
        data: {
          completed: false,
          updateHistoryId: null,
        },
      })
    })
  }

  async notifySlackOnProUpgrade(campaignId: number) {
    try {
      const campaign = await this.client.campaign.findUnique({
        where: { id: campaignId },
        select: { details: true, user: { select: { email: true } } },
      })
      if (!campaign?.details) return

      if (isTestCampaign({ user: campaign.user })) {
        return
      }

      if (campaign.details.proUpgradeSlackNotifiedAt) {
        return
      }

      // Tracker-cohort campaigns have campaign_tracker_tasks and no legacy
      // default tasks, so route them to the tracker's current-week message;
      // legacy campaigns keep the plan-summary message. The notified-at stamp
      // below is shared, so a campaign is announced once regardless of cohort.
      const trackerTaskCount = await this.client.campaignTrackerTask.count({
        where: { campaignId },
      })
      if (trackerTaskCount > 0) {
        // Skip the stamp when nothing was sent (e.g. upgrade before the first
        // generation), mirroring the legacy no-tasks guard below, so
        // notifyTasksGenerated can announce the first week when it lands.
        const notified = await this.trackerTasks.notifyProUpgrade(campaignId)
        if (!notified) return
      } else {
        const defaultTasksCount = await this.model.count({
          where: { campaignId, isDefaultTask: true },
        })
        // A campaign can upgrade (Stripe webhook) before any tasks exist: no
        // tracker rows and no legacy defaults. This one-shot has no retry, so the
        // CAS Pro-upgrade message is dropped; log it so the gap is observable.
        if (defaultTasksCount === 0) {
          this.logger.warn(
            { campaignId },
            'Pro upgrade with no tracker or default tasks; Slack notification skipped',
          )
          return
        }
        await this.sendCampaignPlanSlackMessage(campaignId)
      }

      await this.campaignsService.patchCampaignDetails(campaignId, {
        proUpgradeSlackNotifiedAt: Date.now(),
      })
    } catch (error) {
      this.logger.error(
        { error, campaignId },
        'Failed to send Slack notification on Pro upgrade',
      )
    }
  }

  async notifySlackDefaultTasksCreated(campaignId: number) {
    try {
      await this.sendCampaignPlanSlackMessage(campaignId)
    } catch (error) {
      this.logger.error(
        { error, campaignId },
        'Failed to send Slack notification for default tasks',
      )
    }
  }

  private async sendCampaignPlanSlackMessage(campaignId: number) {
    const campaign = await this.client.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      include: { user: true, campaignTasks: true },
    })

    const candidateName =
      [campaign.user?.firstName, campaign.user?.lastName]
        .filter((value): value is string => Boolean(value))
        .join(' ') ||
      campaign.data.name ||
      'Unknown'

    const outreachTasks = campaign.campaignTasks.filter(
      (task) =>
        task.flowType === CampaignTaskType.text ||
        task.flowType === CampaignTaskType.robocall,
    )

    const taskLines = outreachTasks.map((task) => {
      // Stored dates are UTC-midnight instants; format from UTC parts so the
      // date the ClickUp automation parses never shifts with the process TZ.
      const dueDate = task.date
        ? formatInTimeZone(task.date, 'UTC', 'MMM d, yyyy')
        : 'No date set'
      return `- ${task.flowType!.toUpperCase()}: ${task.title} (Due: ${dueDate})`
    })

    const { hubspotId } = campaign.data

    const slackBody = [
      ':white_check_mark: *AI Campaign Plan Created*',
      `Candidate: ${candidateName}`,
      `HubSpot ID: ${hubspotId ?? 'N/A'}`,
      '',
      `*Outreach Tasks (${outreachTasks.length}):*`,
      ...(taskLines.length > 0 ? taskLines : ['None']),
    ].join('\n')

    await this.sendSlackWithRetry(
      {
        blocks: [
          {
            type: SlackMessageType.SECTION,
            text: {
              type: SlackMessageType.MRKDWN,
              text: slackBody,
            },
          },
        ],
      },
      SlackChannel.casClickupTasks,
    )
  }

  private async sendSlackWithRetry(
    message: Parameters<SlackService['message']>[0],
    channel: SlackChannel,
    maxAttempts = 3,
  ) {
    // SlackService.message() swallows axios errors and returns undefined on
    // failure, so we have to treat a falsy return as a failure ourselves —
    // a thrown error here would only happen for misconfiguration.
    let lastError: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.slackService.message(message, channel)
        if (result) return
        lastError = new Error('Slack message returned no data')
      } catch (error) {
        lastError = error
      }
      if (attempt === maxAttempts) break
      const delayMs = 2 ** (attempt - 1) * SLACK_RETRY_BASE_DELAY_MS
      this.logger.warn(
        { error: lastError, attempt, channel, delayMs },
        'Slack send failed, retrying',
      )
      await sleep(delayMs)
    }
    throw lastError
  }

  buildParadeAwarenessTasks(
    aiTasks: CampaignTask[],
    electionDateString?: string,
    today = startOfDay(new Date()),
  ): CampaignTask[] {
    if (!electionDateString) return []

    const electionDate = startOfDay(parseIsoDateString(electionDateString))
    const paradePattern = /parade/i
    const minWeeksOut = 4

    return aiTasks.flatMap((task) => {
      if (!task.date) return []
      const matchesParade =
        paradePattern.test(task.title) || paradePattern.test(task.description)
      if (!matchesParade) return []

      const parsed = parseIsoDateString(task.date)
      if (isNaN(parsed.getTime())) return []

      const eventDate = startOfDay(parsed)
      if (differenceInCalendarDays(eventDate, today) < minWeeksOut * 7) {
        return []
      }

      const fourWeeksBefore = subWeeks(eventDate, minWeeksOut)
      const monday = startOfWeek(fourWeeksBefore, {
        weekStartsOn: 1,
      })

      if (isBefore(monday, today)) {
        return []
      }

      return [
        {
          id: `aw-parade-${task.id ?? crypto.randomUUID()}`,
          title: `Contact Parade Organizers for ${task.title}`,
          description: 'Get signed up to march in the parade',
          flowType: CampaignTaskType.awareness,
          week: Math.max(
            1,
            differenceInWeeks(electionDate, monday, {
              roundingMethod: 'ceil',
            }),
          ),
          date: formatDate(monday, DateFormats.isoDate),
          isDefaultTask: false,
        },
      ]
    })
  }

  private mapTasksToCreateData(
    campaignId: number,
    tasks: CampaignTask[],
  ): Prisma.CampaignTaskCreateManyInput[] {
    return tasks.map((task) => ({
      ...(task.id && { id: task.id }),
      campaignId,
      title: task.title,
      description: task.description,
      cta: task.cta ?? null,
      flowType: task.flowType ?? null,
      week: task.week,
      date: startOfDay(parseIsoDateString(task.date)),
      link: task.link,
      proRequired: task.proRequired || false,
      deadline: task.deadline,
      defaultAiTemplateId: task.defaultAiTemplateId,
      completed: false,
      isDefaultTask: task.isDefaultTask || false,
    }))
  }

  async addEventTasks(campaignId: number, tasks: CampaignTask[]) {
    const campaign = await this.client.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      select: { details: true },
    })
    const electionDate = campaign.details?.electionDate
    const electionDay = electionDate
      ? startOfDay(parseIsoDateString(electionDate))
      : null
    if (!electionDay || !isValid(electionDay)) {
      this.logger.info(
        { campaignId, electionDate },
        'skipping event task insert: no valid election date',
      )
      return
    }
    const paradeTasks = this.buildParadeAwarenessTasks(tasks, electionDate)
    const allTasks = [...tasks, ...paradeTasks]
    const filteredTasks = allTasks.filter(
      (task) =>
        !isAfter(startOfDay(parseIsoDateString(task.date)), electionDay),
    )
    const dropped = allTasks.length - filteredTasks.length
    if (dropped > 0) {
      this.logger.info(
        { campaignId, electionDate, dropped },
        'dropped event tasks dated after election',
      )
    }
    if (filteredTasks.length === 0) return
    const tasksToCreate = this.mapTasksToCreateData(campaignId, filteredTasks)
    await this.model.createMany({
      data: tasksToCreate,
      skipDuplicates: true,
    })
  }
}

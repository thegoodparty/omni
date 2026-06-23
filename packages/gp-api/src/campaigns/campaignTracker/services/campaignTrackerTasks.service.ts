import { Injectable, NotFoundException } from '@nestjs/common'
import { addDays, format, startOfDay } from 'date-fns'
import { z } from 'zod'
import {
  Campaign,
  ExperimentRun,
  ExperimentRunStatus,
  Prisma,
} from '../../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { parseIsoDateString } from 'src/shared/util/date.util'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { AgentJobContracts } from '@/generated/agent-job-contracts'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { getUserFullName } from '@/users/util/users.util'
import { CAMPAIGN_TASK_CATALOG } from '@goodparty_org/contracts'
import { VOTER_GOALS_ADVISORY_LOCK_KEY } from '../../campaigns.consts'
import { CompleteTaskBodySchema } from '../../tasks/schemas/completeTaskBody.schema'
import { buildStaticTrackerTaskRows } from './staticTrackerTasks.util'
import {
  CAMPAIGN_TRACKER_EXPERIMENT_TYPE,
  CHANNEL_TO_FLOW_TYPE,
} from '../campaignTracker.consts'

type TrackerParams = AgentJobContracts['campaign_tracker_tasks']['Input']

// The dynamic subset of the catalog is the menu the experiment selects from.
const DYNAMIC_MENU = CAMPAIGN_TASK_CATALOG.filter(
  (task) => task.type === 'dynamic',
).map((task) => ({
  id: task.id,
  title: task.title,
  description: task.description,
  phase: task.phase,
  channel: task.channel,
}))

// Runtime guard over the CAP artifact — the manifest output_schema in Zod form.
const trackerArtifactSchema = z.object({
  generated_at: z.string(),
  tasks: z
    .array(
      z.object({
        kind: z.enum(['task', 'event']),
        catalog_id: z.string().nullable().optional(),
        title: z.string(),
        description: z.string(),
        phase: z.enum(['preLaunch', 'launch', 'active', 'gotv']),
        channel: z.string(),
        date: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        url: z.string().nullable().optional(),
      }),
    )
    .max(12),
})

// Campaign Tracker tasks live in their own table (campaign_tracker_tasks) so the
// new tracker coexists with existing users' campaign_task rows. The completion
// flow mirrors CampaignTasksService against the new model.
@Injectable()
export class CampaignTrackerTasksService extends createPrismaBase(
  MODELS.CampaignTrackerTask,
) {
  constructor(
    private readonly experimentRuns: ExperimentRunsService,
    private readonly s3: S3Service,
  ) {
    super()
  }

  listCampaignTrackerTasks({ id: campaignId }: Campaign) {
    const where: Prisma.CampaignTrackerTaskWhereInput = { campaignId }

    return this.model.findMany({
      where,
      orderBy: [
        { week: Prisma.SortOrder.desc },
        { date: Prisma.SortOrder.asc },
        { id: Prisma.SortOrder.asc },
      ],
    })
  }

  // Create the static (global) launch/pre-launch rows from the catalog so the
  // tracker can render immediately. Idempotent: a no-op once they exist.
  async materializeStaticTasks(campaign: Campaign): Promise<number> {
    const existing = await this.model.count({
      where: { campaignId: campaign.id, isDefaultTask: true },
    })
    if (existing > 0) return 0

    const start = startOfDay(campaign.createdAt)
    const rows = buildStaticTrackerTaskRows(
      campaign.id,
      start,
      this.resolveElectionDate(campaign),
    )
    const { count } = await this.model.createMany({ data: rows })
    return count
  }

  private resolveElectionDate(campaign: Campaign): Date | null {
    const { electionDate, primaryElectionDate } = campaign.details ?? {}
    const chosen = electionDate ?? primaryElectionDate
    return chosen ? startOfDay(parseIsoDateString(chosen)) : null
  }

  // Dispatch the CAP experiment that finds events + prioritizes the week's
  // dynamic tasks. `initial` = first run at plan generation; `weekly` = the
  // cron's re-prioritization, which feeds prior tasks back in.
  async dispatchGeneration(
    campaign: CampaignWith<'user'>,
    mode: 'initial' | 'weekly',
  ): Promise<void> {
    const raceId = campaign.details?.raceId
    const clerkUserId = campaign.user?.clerkId
    const fullName = campaign.user ? getUserFullName(campaign.user) : ''
    if (!raceId || !clerkUserId || !fullName) {
      this.logger.warn(
        { campaignId: campaign.id },
        'tracker dispatch skipped: missing raceId, clerkId, or name',
      )
      return
    }

    const priorTasks =
      mode === 'weekly'
        ? (
            await this.model.findMany({
              where: { campaignId: campaign.id, isDefaultTask: false },
              select: { title: true, completed: true },
            })
          ).map((t) => ({
            catalog_id: null,
            title: t.title,
            completed: t.completed,
          }))
        : []

    // Plan + story content feed personalization; story arrives with the
    // campaign-story feature, so both are null by contract until wired.
    const params: TrackerParams = {
      race_id: raceId,
      user_full_name: fullName,
      mode,
      today: format(new Date(), 'yyyy-MM-dd'),
      election_date: campaign.details?.electionDate ?? null,
      state: campaign.details?.state ?? null,
      city: campaign.details?.city ?? null,
      campaign_plan: null,
      campaign_story: null,
      task_catalog: DYNAMIC_MENU,
      prior_tasks: priorTasks,
    }

    await this.experimentRuns.dispatchRun({
      type: CAMPAIGN_TRACKER_EXPERIMENT_TYPE,
      organizationSlug: campaign.organizationSlug,
      clerkUserId,
      params,
    })
  }

  // Queue-consumer hook: on a completed tracker run, load the artifact and
  // replace the campaign's generated (non-static) rows with the new set. Static
  // rows (isDefaultTask=true) are left in place. Fail-closed on a bad artifact.
  async onExperimentRunCompleted(run: ExperimentRun): Promise<void> {
    if (run.status !== ExperimentRunStatus.COMPLETED) return
    if (run.experimentType !== CAMPAIGN_TRACKER_EXPERIMENT_TYPE) return

    if (!run.artifactBucket || !run.artifactKey) {
      await this.experimentRuns.markFailed(
        run.runId,
        'completed run has no artifact location',
      )
      throw new Error(`run ${run.runId} completed without an artifact location`)
    }

    const campaign = await this.client.campaign.findFirst({
      where: { organizationSlug: run.organizationSlug },
      select: { id: true },
    })
    if (!campaign) return

    try {
      const raw = await this.s3.getFile(run.artifactBucket, run.artifactKey)
      if (!raw) throw new Error('artifact is missing or empty')
      const { tasks } = trackerArtifactSchema.parse(JSON.parse(raw))

      const start = startOfDay(new Date())
      const rows: Prisma.CampaignTrackerTaskCreateManyInput[] = tasks.map(
        (task, index) => ({
          campaignId: campaign.id,
          title: task.title,
          description: task.description,
          flowType: CHANNEL_TO_FLOW_TYPE[task.channel] ?? null,
          week: 0,
          // Events keep their real date; dynamic tasks are dated by priority
          // order so the upcoming-week list sorts as the model ranked it.
          date: task.date
            ? startOfDay(parseIsoDateString(task.date))
            : addDays(start, index),
          link: task.url ?? null,
          phase: task.phase,
          isDefaultTask: false,
          completed: false,
        }),
      )

      await this.client.$transaction(async (tx) => {
        await tx.campaignTrackerTask.deleteMany({
          where: { campaignId: campaign.id, isDefaultTask: false },
        })
        if (rows.length > 0) {
          await tx.campaignTrackerTask.createMany({ data: rows })
        }
      })
    } catch (error) {
      await this.experimentRuns.markFailed(
        run.runId,
        error instanceof Error ? error.message : String(error),
      )
      throw error
    }
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

      const task = await tx.campaignTrackerTask.findFirst({
        where: { campaignId, id },
      })
      if (!task) {
        throw new NotFoundException(`Tracker task ${id} not found`)
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

      return tx.campaignTrackerTask.update({
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
      const task = await tx.campaignTrackerTask.findFirst({
        where: { campaignId, id },
      })
      if (!task) {
        throw new NotFoundException(`Tracker task ${id} not found`)
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

      return tx.campaignTrackerTask.update({
        where: { id: task.id },
        data: {
          completed: false,
          updateHistoryId: null,
        },
      })
    })
  }
}

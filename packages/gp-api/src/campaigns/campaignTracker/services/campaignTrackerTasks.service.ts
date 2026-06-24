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
import { VOTER_GOALS_ADVISORY_LOCK_KEY } from '../../campaigns.consts'
import { CompleteTaskBodySchema } from '../../tasks/schemas/completeTaskBody.schema'
import { buildStaticTrackerTaskRows } from './staticTrackerTasks.util'
import {
  CAMPAIGN_TRACKER_EXPERIMENT_TYPE,
  CHANNEL_TO_FLOW_TYPE,
} from '../campaignTracker.consts'

type TrackerParams = AgentJobContracts['campaign_tracker_tasks']['Input']

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

    const { campaignPlan, campaignStory } =
      await this.loadPersonalizationContext(campaign.id)

    // The dynamic task menu ships with the experiment as an attachment, and the
    // agent fetches prior tasks + completion live via the tracker-tasks MCP
    // tool (weekly mode) — neither rides in params, which keeps us under the
    // dispatch param-size limit. Plan + story summaries feed personalization;
    // both are nullable by contract (a campaign here normally has both).
    const params: TrackerParams = {
      race_id: raceId,
      user_full_name: fullName,
      mode,
      today: format(new Date(), 'yyyy-MM-dd'),
      election_date: campaign.details?.electionDate ?? null,
      state: campaign.details?.state ?? null,
      city: campaign.details?.city ?? null,
      campaign_plan: campaignPlan,
      campaign_story: campaignStory,
    }

    await this.experimentRuns.dispatchRun({
      type: CAMPAIGN_TRACKER_EXPERIMENT_TYPE,
      organizationSlug: campaign.organizationSlug,
      clerkUserId,
      params,
    })
  }

  // First-run bootstrap, called once the campaign plan finishes generating
  // (the story is already complete by then — a plan can't generate without
  // it). Materializes the static launch/pre-launch rows so the tracker renders
  // immediately, then kicks the initial CAP generation. Idempotent: static
  // rows are a no-op once present, and the initial dispatch is skipped if any
  // tracker run already exists for the org (so a re-generated plan, or a second
  // section result, can't fire a duplicate run).
  async bootstrapForCampaign(campaign: CampaignWith<'user'>): Promise<void> {
    await this.materializeStaticTasks(campaign)

    const existingRun = await this.experimentRuns.findFirst({
      where: {
        organizationSlug: campaign.organizationSlug,
        experimentType: CAMPAIGN_TRACKER_EXPERIMENT_TYPE,
      },
    })
    if (existingRun) return

    await this.dispatchGeneration(campaign, 'initial')
  }

  // Assemble the plan + story summary strings the CAP run uses as
  // personalization context. Read straight off the DB (not via the sibling
  // services) so this service stays free of a dependency cycle with
  // CampaignStrategyService, which depends on this service for bootstrap.
  private async loadPersonalizationContext(campaignId: number): Promise<{
    campaignPlan: string | null
    campaignStory: string | null
  }> {
    const [story, strategy] = await Promise.all([
      this.client.campaignStory.findUnique({ where: { campaignId } }),
      this.client.campaignStrategy.findUnique({
        where: { campaignId },
        include: {
          opportunities: { orderBy: { order: Prisma.SortOrder.asc } },
          challenges: { orderBy: { order: Prisma.SortOrder.asc } },
          opponents: true,
        },
      }),
    ])

    const storyParts = [
      story?.why ? `Why I'm running:\n${story.why}` : null,
      story?.background ? `Background:\n${story.background}` : null,
      story?.issues ? `Key issues:\n${story.issues}` : null,
    ].filter((part): part is string => part !== null)
    const campaignStory = storyParts.length ? storyParts.join('\n\n') : null

    const planParts: string[] = []
    if (strategy?.opportunities.length) {
      const lines = strategy.opportunities
        .map((o) => `- ${o.content}`)
        .join('\n')
      planParts.push(`Opportunities:\n${lines}`)
    }
    if (strategy?.challenges.length) {
      const lines = strategy.challenges.map((c) => `- ${c.content}`).join('\n')
      planParts.push(`Challenges:\n${lines}`)
    }
    if (strategy?.opponents.length) {
      const lines = strategy.opponents
        .map((op) => `- ${op.fullName} (${op.partyAffiliation})`)
        .join('\n')
      planParts.push(`Likely opponents:\n${lines}`)
    }
    const campaignPlan = planParts.length ? planParts.join('\n\n') : null

    return { campaignPlan, campaignStory }
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

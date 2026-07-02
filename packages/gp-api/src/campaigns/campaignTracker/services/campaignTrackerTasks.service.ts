import { Injectable, NotFoundException } from '@nestjs/common'
import { addDays, differenceInCalendarDays, format, startOfDay } from 'date-fns'
import { z } from 'zod'
import {
  Campaign,
  CampaignTaskType,
  ExperimentRun,
  ExperimentRunStatus,
  Prisma,
} from '../../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import {
  CENTRAL_TIMEZONE,
  mondayOfWeekUtc,
  nextMondayUtcMidnight,
  parseIsoDateAsUTC,
  parseIsoDateString,
} from 'src/shared/util/date.util'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import {
  SlackChannel,
  SlackMessageType,
} from '@/vendors/slack/slackService.types'
import { AgentJobContracts } from '@/generated/agent-job-contracts'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { getUserFullName } from '@/users/util/users.util'
import { serializeWebsiteIssues } from '@/websites/util/serializeWebsiteIssues.util'
import { serializeWebsiteBio } from '@/websites/util/serializeWebsiteBio.util'
import {
  TRACKER_STATIC_TASKS_ADVISORY_LOCK_KEY,
  VOTER_GOALS_ADVISORY_LOCK_KEY,
} from '../../campaigns.consts'
import { CompleteTaskBodySchema } from '../../tasks/schemas/completeTaskBody.schema'
import {
  buildOutreachTrackerTaskRows,
  buildStaticTrackerTaskRows,
} from './staticTrackerTasks.util'
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
    private readonly slack: SlackService,
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
  // tracker can render immediately. Idempotent and race-safe: the plan endpoint
  // that triggers this at generation start is polled, so an advisory lock keyed
  // on the campaign serializes concurrent first-loads (the count check alone
  // isn't atomic, so two callers could both read zero and each insert the rows).
  async materializeStaticTasks(campaign: Campaign): Promise<number> {
    return this.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TRACKER_STATIC_TASKS_ADVISORY_LOCK_KEY}::integer, ${campaign.id}::integer)`

      const existing = await tx.campaignTrackerTask.count({
        where: { campaignId: campaign.id, isDefaultTask: true },
      })
      if (existing > 0) return 0

      // Anchor the relative (asap / onboarding / preLaunch / launch) static tasks
      // to the upcoming Monday (the same week the initial dynamic generation is
      // dated to), so a freshly-bootstrapped campaign schedules them for the
      // coming week instead of relative to its creation date. That matters most
      // for an existing campaign onboarded long ago, whose createdAt-anchored
      // tasks would otherwise all land in the past. Stamped once (idempotent);
      // election-relative tasks still key off the election date.
      const start = nextMondayUtcMidnight(new Date(), CENTRAL_TIMEZONE)
      const electionDate = this.resolveElectionDate(campaign)
      const rows = [
        ...buildStaticTrackerTaskRows(campaign.id, start, electionDate),
        // The plan's 7 text/robocall sends are deterministic, not agent-picked.
        // Suppressed entirely if the candidate lost their primary.
        ...buildOutreachTrackerTaskRows(
          campaign.id,
          start,
          electionDate,
          campaign.primaryResult === 'lost',
        ),
      ]
      const { count } = await tx.campaignTrackerTask.createMany({ data: rows })
      return count
    })
  }

  // Remove the deterministic outreach (text/robocall) rows. Called from the
  // weekly cron when the candidate has lost their primary: a lost-primary race
  // is over, so the plan's general-election contact schedule no longer applies
  // and the tracker must stop suggesting texts/robocalls.
  async removeOutreachTasks(campaignId: number): Promise<number> {
    const { count } = await this.model.deleteMany({
      where: {
        campaignId,
        isDefaultTask: true,
        flowType: { in: [CampaignTaskType.text, CampaignTaskType.robocall] },
      },
    })
    return count
  }

  private resolveElectionDate(campaign: Campaign): Date | null {
    const { electionDate, primaryElectionDate } = campaign.details ?? {}
    const chosen = electionDate ?? primaryElectionDate
    // Parse as UTC midnight, not local: date-only strings via parseIsoDateString
    // land on local midnight, which on a server east of UTC shifts the date back
    // a UTC day. The GOTV gate then diverges from the digest's UTC-only SQL
    // (::date - NOW()::date), and the election-relative task dates drift too.
    return chosen ? parseIsoDateAsUTC(chosen) : null
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
      // Primary-only campaigns have no general electionDate yet; fall back to
      // the primary so the agent can still enter GOTV mode (mirrors
      // resolveElectionDate).
      election_date:
        campaign.details?.electionDate ??
        campaign.details?.primaryElectionDate ??
        null,
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
  // it). The two plan sections complete on independent SQS messages (possibly
  // different pods), so both can reach here at once. Claim the one-shot
  // `trackerBootstrapped` flag with a single conditional update: only the call
  // that flips false->true proceeds to materialize the static rows + dispatch
  // the initial CAP run. A claim-losing call (count 0) no-ops, so concurrent
  // completions and re-generated plans can't double-materialize or
  // double-dispatch. A run that later fails is retried by the weekly cron
  // (the campaign is in its cohort once static rows exist).
  async bootstrapForCampaign(campaign: CampaignWith<'user'>): Promise<void> {
    const { count } = await this.client.campaignStrategy.updateMany({
      where: { campaignId: campaign.id, trackerBootstrapped: false },
      data: { trackerBootstrapped: true },
    })
    if (count === 0) return

    // The flag is claimed before the work, so a failure here would otherwise
    // leave the campaign bootstrapped-but-empty: no static rows means it's
    // outside the weekly cron's cohort, and the flag blocks a re-bootstrap.
    // Release the claim on failure so the next trigger can retry.
    try {
      await this.materializeStaticTasks(campaign)
      await this.dispatchGeneration(campaign, 'initial')
    } catch (error) {
      await this.client.campaignStrategy.updateMany({
        where: { campaignId: campaign.id },
        data: { trackerBootstrapped: false },
      })
      throw error
    }
  }

  // Assemble the plan + story summary strings the CAP run uses as
  // personalization context. Read straight off the DB (not via the sibling
  // services) so this service stays free of a dependency cycle with
  // CampaignStrategyService, which depends on this service for bootstrap.
  private async loadPersonalizationContext(campaignId: number): Promise<{
    campaignPlan: string | null
    campaignStory: string | null
  }> {
    const [story, strategy, website] = await Promise.all([
      this.client.campaignStory.findUnique({ where: { campaignId } }),
      this.client.campaignStrategy.findUnique({
        where: { campaignId },
        include: {
          opportunities: { orderBy: { order: Prisma.SortOrder.asc } },
          challenges: { orderBy: { order: Prisma.SortOrder.asc } },
          opponents: true,
        },
      }),
      // The "why" and issues live on the website now (shared with Pro-upgrade),
      // not the story.
      this.client.website.findUnique({
        where: { campaignId },
        select: { content: true },
      }),
    ])

    const why = serializeWebsiteBio(website?.content?.about?.bio)
    const issuesText = serializeWebsiteIssues(
      website?.content?.about?.issues ?? [],
    )
    const storyParts = [
      why ? `Why I'm running:\n${why}` : null,
      story?.background ? `Background:\n${story.background}` : null,
      issuesText ? `Key issues:\n${issuesText}` : null,
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
  // append its tasks as a new generation. Prior generations are kept (not
  // deleted) so completion is never wiped on a weekly re-run and the weekly
  // run's prior-tasks MCP lookup has history to dedupe against. Static rows
  // (isDefaultTask=true) are untouched. Fail-closed on a bad artifact.
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
      const parsed = trackerArtifactSchema.parse(JSON.parse(raw))
      // Outreach (text/robocall) is owned deterministically by the plan's
      // contact schedule, not the agent — drop any the CAP returns. The catalog
      // attachment already excludes these channels; this is the safety net.
      const tasks = parsed.tasks.filter(
        (task) => task.channel !== 'text' && task.channel !== 'robocall',
      )

      // Date dateless tasks across the upcoming Mon-Sun week (index 0 = next
      // Monday). nextMondayUtcMidnight is timezone-aware and shared with the
      // digest's window calculation, so the generation's tasks land in the
      // same week the digest filters on, rather than skewing a week past
      // windowStart when the run completes after UTC-midnight on Monday.
      const weekStart = nextMondayUtcMidnight(new Date(), CENTRAL_TIMEZONE)
      // `week` is the generation index: each run appends the next one, the
      // frontend renders only the highest (latest) dynamic generation, and
      // older generations persist for completion history + prior-task dedupe.
      const latest = await this.model.findFirst({
        where: { campaignId: campaign.id, isDefaultTask: false },
        orderBy: { week: Prisma.SortOrder.desc },
        select: { week: true },
      })
      const generation = (latest?.week ?? 0) + 1

      // Date the dateless tasks across the upcoming Mon-Sun week with a counter
      // that skips dated events — using the raw array index would let an event
      // in an early slot push a later dateless task past day 6 (windowEnd) and
      // out of the digest. Clamp to day 6 so every dateless task stays in-week.
      let datelessOffset = 0
      const rows: Prisma.CampaignTrackerTaskCreateManyInput[] = tasks.map(
        (task) => {
          let date: Date
          if (task.date) {
            date = startOfDay(parseIsoDateString(task.date))
          } else {
            date = addDays(weekStart, Math.min(datelessOffset, 6))
            datelessOffset += 1
          }
          return {
            campaignId: campaign.id,
            title: task.title,
            description: task.description,
            flowType: CHANNEL_TO_FLOW_TYPE[task.channel] ?? null,
            week: generation,
            // Events keep their real date; dynamic tasks are dated across the
            // upcoming week so the list sorts as the model ranked it.
            date,
            link: task.url ?? null,
            phase: task.phase,
            isDefaultTask: false,
            completed: false,
          }
        },
      )

      if (rows.length > 0) {
        await this.model.createMany({ data: rows })
        // Notify CAS with the week's tasks (Pro candidates only). Fires for the
        // initial bootstrap (first week) and every weekly regen; the title
        // reflects which. Best-effort: the rows are already committed, so a Slack
        // failure must not reach the catch below (markFailed + redeliver).
        await this.notifyTasksGenerated(
          campaign.id,
          weekStart,
          generation,
        ).catch((error: unknown) =>
          this.logger.warn(
            { error, campaignId: campaign.id },
            'tracker Slack notification failed',
          ),
        )
      }
    } catch (error) {
      await this.experimentRuns.markFailed(
        run.runId,
        error instanceof Error ? error.message : String(error),
      )
      throw error
    }
  }

  // Post the week's tasks to the CAS Slack channel after a generation lands
  // (Pro candidates only). Fires for the initial bootstrap and every weekly
  // regen; the title distinguishes the first week from an ongoing week.
  private async notifyTasksGenerated(
    campaignId: number,
    weekStart: Date,
    generation: number,
  ): Promise<void> {
    const campaign = await this.client.campaign.findUnique({
      where: { id: campaignId },
      include: { user: true },
    })
    if (!campaign?.isPro) return
    const title =
      generation === 1
        ? ":rocket: *Campaign tracker launched: first week's tasks*"
        : ':calendar: *Weekly campaign tasks generated*'
    await this.postCampaignWeekToSlack(campaign, weekStart, title)
  }

  // One-shot on Pro upgrade: post the candidate's next week of tasks so CAS can
  // start executing. Tasks are anchored to a Monday fixed at bootstrap/generation
  // time, which can predate this upgrade (Stripe webhook, no time constraint), so
  // deriving the window from the current clock can land on an empty future week.
  // Anchor it to the earliest incomplete task instead, so it always lands on real
  // tasks. Cohort gating (tracker rows) + idempotency live in the caller. Returns
  // false without posting when there is nothing to send (not Pro, no tasks, or no
  // dynamic generation yet) so the caller can skip the notified-at stamp.
  async notifyProUpgrade(campaignId: number): Promise<boolean> {
    const campaign = await this.client.campaign.findUnique({
      where: { id: campaignId },
      include: { user: true },
    })
    if (!campaign?.isPro) return false
    const earliest = await this.model.findFirst({
      where: { campaignId, completed: false },
      orderBy: { date: Prisma.SortOrder.asc },
      select: { date: true },
    })
    if (!earliest) return false
    // Skip until the first CAP generation lands. The upgrade can arrive before it
    // (async Stripe webhook); with no dynamic rows the week collapses to the
    // deterministic outreach, which is election-relative and rarely falls in the
    // window, so the post would read "Tasks (0): None". notifyTasksGenerated
    // announces the first week (generation 1) when it lands instead.
    const latest = await this.model.findFirst({
      where: { campaignId, isDefaultTask: false },
      orderBy: { week: Prisma.SortOrder.desc },
      select: { week: true },
    })
    if (!latest) return false
    // Floor to the earliest task's Monday so postCampaignWeekToSlack's Mon-Sun
    // window (and label) align to a real calendar week — earliest.date may fall
    // on any weekday.
    await this.postCampaignWeekToSlack(
      campaign,
      mondayOfWeekUtc(earliest.date),
      ':tada: *Pro upgrade: your campaign tasks*',
    )
    return true
  }

  // Build + post one Mon-Sun week's task list for a Pro campaign to
  // casClickupTasks: the latest dynamic generation plus the deterministic
  // text/robocall outreach due that week (what the candidate sees in their week
  // view). Mirrors fetchTrackerDigestRows' scoping so the CAS message, the
  // digest email, and the tracker never disagree. Mirrors the legacy
  // campaign-plan message format.
  private async postCampaignWeekToSlack(
    campaign: CampaignWith<'user'>,
    weekStart: Date,
    title: string,
  ): Promise<void> {
    const windowEnd = addDays(weekStart, 7)
    const latest = await this.model.findFirst({
      where: { campaignId: campaign.id, isDefaultTask: false },
      orderBy: { week: Prisma.SortOrder.desc },
      select: { week: true },
    })
    // Mirror the digest's 30-day GOTV gate: don't surface GOTV-phase tasks to
    // CAS until the election is within 30 days (the UI + email hide them until
    // then), so CAS never gets GOTV work before the candidate sees it.
    const electionDate = this.resolveElectionDate(campaign)
    const withinGotvWindow =
      electionDate !== null &&
      differenceInCalendarDays(electionDate, new Date()) <= 30
    const tasks = await this.model.findMany({
      where: {
        campaignId: campaign.id,
        completed: false,
        date: { gte: weekStart, lt: windowEnd },
        ...(withinGotvWindow ? {} : { NOT: { phase: 'gotv' } }),
        // Latest dynamic generation + the deterministic text/robocall outreach,
        // matching fetchTrackerDigestRows. isDefaultTask=false guards the
        // generation clause because a default row's calendar-offset week can
        // equal the latest generation index; the static setup checklist (default
        // rows that are not outreach) is not part of the week view.
        OR: [
          {
            isDefaultTask: true,
            flowType: {
              in: [CampaignTaskType.text, CampaignTaskType.robocall],
            },
          },
          ...(latest ? [{ isDefaultTask: false, week: latest.week }] : []),
        ],
      },
      orderBy: { date: Prisma.SortOrder.asc },
    })

    const candidateName =
      (campaign.user ? getUserFullName(campaign.user) : '') ||
      campaign.data.name ||
      'Unknown'
    const { hubspotId } = campaign.data
    const startLabel = format(weekStart, 'MMM d')
    const endLabel = format(addDays(weekStart, 6), 'MMM d')
    const taskLines = tasks.map((task) => {
      const due = task.date ? format(task.date, 'MMM d') : 'No date set'
      const channel = task.flowType ? `${task.flowType.toUpperCase()}: ` : ''
      return `- ${channel}${task.title} (${due})`
    })
    const body = [
      title,
      `Candidate: ${candidateName}`,
      `HubSpot ID: ${hubspotId ?? 'N/A'}`,
      `Week of ${startLabel} - ${endLabel}`,
      '',
      `*Tasks (${tasks.length}):*`,
      ...(taskLines.length > 0 ? taskLines : ['None']),
    ].join('\n')

    await this.slack.message(
      {
        blocks: [
          {
            type: SlackMessageType.SECTION,
            text: { type: SlackMessageType.MRKDWN, text: body },
          },
        ],
      },
      SlackChannel.casClickupTasks,
    )
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

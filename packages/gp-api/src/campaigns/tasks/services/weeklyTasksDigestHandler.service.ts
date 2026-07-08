import { Injectable } from '@nestjs/common'
import { CampaignTaskType, Prisma } from '../../../generated/prisma'
import { AnalyticsService } from 'src/analytics/analytics.service'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { toDateOnlyString } from 'src/shared/util/date.util'
import { EVENTS } from 'src/vendors/segment/segment.types'
import { WeeklyTasksDigestMessage } from 'src/queue/queue.types'

const OUTREACH_FLOW_TYPES: CampaignTaskType[] = [
  CampaignTaskType.text,
  CampaignTaskType.robocall,
  CampaignTaskType.doorKnocking,
  CampaignTaskType.phoneBanking,
]
// The deterministic outreach the tracker materializes as default rows: the 7
// text/robocall sends. These are the only default rows the digest includes
// alongside the dynamic picks (the setup checklist is not emailed). Narrower
// than OUTREACH_FLOW_TYPES, which also ranks dynamic doorKnocking/phoneBanking.
const DETERMINISTIC_OUTREACH_FLOW_TYPES: CampaignTaskType[] = [
  CampaignTaskType.text,
  CampaignTaskType.robocall,
]
// Surface the top 3 uncompleted tasks for the week (TDD: "Change top-5 to
// top-3"). The Segment event still carries all 5 slots — slots 4-5 go blank so
// HubSpot clears stale data — so there is no change needed on the email side.
const MAX_TASKS = 3
const MIN_TASKS = 3

interface DigestRow {
  campaign_id: number
  user_id: number
  completed_count: number
  incomplete_count: number
  slot: number
  title: string
  description: string
  flow_type: CampaignTaskType | null
  date: Date
  week: number
}

interface TopTaskRow {
  title: string
  description: string
  flow_type: CampaignTaskType | null
  date: Date
  week: number
}

interface WeeklyDigestProperties {
  plan_tasks_completed: number
  plan_total_tasks: number
  task_name_1: string
  task_description_1: string
  task_type_1: string
  task_due_date_1: string
  task_week_number_1: number | null
  task_name_2: string
  task_description_2: string
  task_type_2: string
  task_due_date_2: string
  task_week_number_2: number | null
  task_name_3: string
  task_description_3: string
  task_type_3: string
  task_due_date_3: string
  task_week_number_3: number | null
  task_name_4: string
  task_description_4: string
  task_type_4: string
  task_due_date_4: string
  task_week_number_4: number | null
  task_name_5: string
  task_description_5: string
  task_type_5: string
  task_due_date_5: string
  task_week_number_5: number | null
}

type TaskSlotProperties = Pick<
  WeeklyDigestProperties,
  | 'task_name_1'
  | 'task_description_1'
  | 'task_type_1'
  | 'task_due_date_1'
  | 'task_week_number_1'
  | 'task_name_2'
  | 'task_description_2'
  | 'task_type_2'
  | 'task_due_date_2'
  | 'task_week_number_2'
  | 'task_name_3'
  | 'task_description_3'
  | 'task_type_3'
  | 'task_due_date_3'
  | 'task_week_number_3'
  | 'task_name_4'
  | 'task_description_4'
  | 'task_type_4'
  | 'task_due_date_4'
  | 'task_week_number_4'
  | 'task_name_5'
  | 'task_description_5'
  | 'task_type_5'
  | 'task_due_date_5'
  | 'task_week_number_5'
>

// Always emits all 5 task slots. Empty slots send blank/null values so HubSpot
// clears stale data from the previous week's digest.
function buildTaskProperties(tasks: TopTaskRow[]): TaskSlotProperties {
  const [t1, t2, t3, t4, t5] = tasks
  return {
    task_name_1: t1?.title ?? '',
    task_description_1: t1?.description ?? '',
    task_type_1: t1?.flow_type ?? '',
    task_due_date_1: toDateOnlyString(t1?.date) ?? '',
    task_week_number_1: t1?.week ?? null,
    task_name_2: t2?.title ?? '',
    task_description_2: t2?.description ?? '',
    task_type_2: t2?.flow_type ?? '',
    task_due_date_2: toDateOnlyString(t2?.date) ?? '',
    task_week_number_2: t2?.week ?? null,
    task_name_3: t3?.title ?? '',
    task_description_3: t3?.description ?? '',
    task_type_3: t3?.flow_type ?? '',
    task_due_date_3: toDateOnlyString(t3?.date) ?? '',
    task_week_number_3: t3?.week ?? null,
    task_name_4: t4?.title ?? '',
    task_description_4: t4?.description ?? '',
    task_type_4: t4?.flow_type ?? '',
    task_due_date_4: toDateOnlyString(t4?.date) ?? '',
    task_week_number_4: t4?.week ?? null,
    task_name_5: t5?.title ?? '',
    task_description_5: t5?.description ?? '',
    task_type_5: t5?.flow_type ?? '',
    task_due_date_5: toDateOnlyString(t5?.date) ?? '',
    task_week_number_5: t5?.week ?? null,
  }
}

interface CampaignDigestGroup {
  userId: number
  completedCount: number
  incompleteCount: number
  tasks: TopTaskRow[]
}

function groupByCampaign(rows: DigestRow[]): Map<number, CampaignDigestGroup> {
  const groups = new Map<number, CampaignDigestGroup>()
  for (const row of rows) {
    let group = groups.get(row.campaign_id)
    if (!group) {
      group = {
        userId: row.user_id,
        completedCount: row.completed_count,
        incompleteCount: row.incomplete_count,
        tasks: [],
      }
      groups.set(row.campaign_id, group)
    }
    group.tasks.push({
      title: row.title,
      description: row.description,
      flow_type: row.flow_type,
      date: row.date,
      week: row.week,
    })
  }
  return groups
}

@Injectable()
export class WeeklyTasksDigestHandlerService extends createPrismaBase(
  MODELS.CampaignTrackerTask,
) {
  constructor(private readonly analytics: AnalyticsService) {
    super()
  }

  async handleWeeklyTasksDigest(data: WeeklyTasksDigestMessage) {
    const windowStart = new Date(data.windowStart)
    const windowEnd = new Date(data.windowEnd)

    this.logger.info(
      { windowStart, windowEnd },
      'Processing weekly tasks digest',
    )

    // Two mutually exclusive cohorts, one digest per campaign:
    //  - tracker cohort: campaigns with campaign_tracker_tasks rows get the
    //    Campaign Tracker v3 digest (latest generation only, GOTV window).
    //  - legacy cohort: campaigns with NO tracker rows get the pre-v3
    //    campaign_task digest, unchanged. Story-off campaigns never bootstrap
    //    the tracker, so they stay here and behave exactly as before v3.
    const [trackerRows, legacyRows] = await Promise.all([
      this.fetchTrackerDigestRows(windowStart, windowEnd),
      this.fetchLegacyDigestRows(windowStart, windowEnd),
    ])

    const campaigns = groupByCampaign([...trackerRows, ...legacyRows])

    let sent = 0
    let failed = 0

    for (const [campaignId, group] of campaigns) {
      try {
        const sortedTasks = [...group.tasks].sort(
          (a, b) => a.date.getTime() - b.date.getTime(),
        )

        const properties: WeeklyDigestProperties = {
          plan_tasks_completed: group.completedCount,
          plan_total_tasks: group.completedCount + group.incompleteCount,
          ...buildTaskProperties(sortedTasks),
        }

        await this.analytics.track(
          group.userId,
          EVENTS.CampaignPlan.WeeklyTasksDigest,
          // The spread widens our strict WeeklyDigestProperties type to match
          // analytics.track's `Record<string, unknown>` signature. See WEB-4530
          // for the TODO to make the track signature generic.
          { ...properties },
        )

        this.logger.info(
          {
            campaignId,
            userId: group.userId,
            taskCount: group.tasks.length,
          },
          'Sent weekly tasks digest event',
        )
        sent++
      } catch (error) {
        this.logger.error(
          { campaignId, error },
          'Failed to process weekly digest for campaign',
        )
        failed++
      }
    }

    this.logger.info(
      { sent, failed, eligible: campaigns.size },
      'Weekly tasks digest complete',
    )
  }

  // Campaign Tracker v3 cohort: campaigns with campaign_tracker_tasks rows.
  // For every such campaign with a future election date and at least MIN_TASKS
  // incomplete tasks in the window, return the top MAX_TASKS incomplete tasks
  // (outreach types prioritized, then by date). Each row denormalizes the
  // campaign's counts so we can group in JS.
  private fetchTrackerDigestRows(
    windowStart: Date,
    windowEnd: Date,
  ): Promise<DigestRow[]> {
    return this.client.$queryRaw<DigestRow[]>`
      WITH latest_gen AS (
        SELECT campaign_id, MAX(week) AS gen
        FROM campaign_tracker_tasks
        WHERE is_default_task = false
        GROUP BY campaign_id
      ),
      visible AS (
        -- The weekly digest mirrors the tracker's week view: the latest dynamic
        -- generation plus the deterministic text/robocall outreach dated in the
        -- window. The static setup checklist (default rows that are not outreach)
        -- is excluded; it lives in the Pre-launch/Launch/GOTV-ops sections, not
        -- the active week the digest promotes. Outreach is prioritized in the
        -- ranking below because those sends matter most.
        --
        -- LEFT JOIN so a campaign with outreach dated in the window still
        -- surfaces even if its dynamic generation is momentarily absent. The
        -- dynamic branch needs is_default_task = false alongside week = g.gen
        -- because a default row's calendar-offset week can coincidentally equal
        -- the latest generation index.
        SELECT t.*
        FROM campaign_tracker_tasks t
        LEFT JOIN latest_gen g ON g.campaign_id = t.campaign_id
        JOIN campaign c ON c.id = t.campaign_id
        WHERE (
            (t.is_default_task = false AND t.week = g.gen)
            OR (
              t.is_default_task = true
              AND t.flow_type::text IN (
                ${Prisma.join(DETERMINISTIC_OUTREACH_FLOW_TYPES)}
              )
            )
          )
          -- Mirror the UI's 30-day GOTV window: don't email GOTV tasks until
          -- the election is within 30 days (the UI hides them until then).
          -- Primary-only campaigns fall back to primaryElectionDate, matching
          -- resolveElectionDate / the dispatch eligibility check.
          AND (
            t.phase IS DISTINCT FROM 'gotv'
            OR (
              COALESCE(
                c.details->>'electionDate',
                c.details->>'primaryElectionDate'
              ) ~ '^\\d{4}-\\d{2}-\\d{2}'
              AND (
                COALESCE(
                  c.details->>'electionDate',
                  c.details->>'primaryElectionDate'
                )
              )::date - NOW()::date <= 30
            )
          )
      ),
      eligible AS (
        SELECT
          c.id,
          c.user_id,
          COUNT(*) FILTER (WHERE t.completed = true)::int  AS completed_count,
          COUNT(*) FILTER (WHERE t.completed = false)::int AS incomplete_count
        FROM campaign c
        JOIN visible t ON t.campaign_id = c.id
        WHERE c.is_active = true
          AND c.is_demo = false
          AND COALESCE(
            c.details->>'electionDate',
            c.details->>'primaryElectionDate'
          ) ~ '^\\d{4}-\\d{2}-\\d{2}'
          AND (
            COALESCE(
              c.details->>'electionDate',
              c.details->>'primaryElectionDate'
            )
          )::date > NOW()::date
          AND t.date >= ${windowStart}
          AND t.date < ${windowEnd}
        GROUP BY c.id, c.user_id
        HAVING COUNT(*) FILTER (WHERE t.completed = false) >= ${MIN_TASKS}
      ),
      ranked_tasks AS (
        SELECT
          t.campaign_id,
          t.title,
          t.description,
          t.flow_type,
          t.date,
          t.week,
          ROW_NUMBER() OVER (
            PARTITION BY t.campaign_id
            ORDER BY
              CASE WHEN t.flow_type::text IN (${Prisma.join(OUTREACH_FLOW_TYPES)})
                THEN 0 ELSE 1 END,
              t.date ASC
          ) AS slot
        FROM visible t
        JOIN eligible e ON e.id = t.campaign_id
        WHERE t.completed = false
          AND t.date >= ${windowStart}
          AND t.date < ${windowEnd}
      )
      SELECT
        e.id           AS campaign_id,
        e.user_id,
        e.completed_count,
        e.incomplete_count,
        rt.slot::int   AS slot,
        rt.title,
        rt.description,
        rt.flow_type,
        rt.date,
        rt.week
      FROM eligible e
      JOIN ranked_tasks rt ON rt.campaign_id = e.id
      WHERE rt.slot <= ${MAX_TASKS}
      ORDER BY e.id, rt.slot
    `
  }

  // Legacy (pre-v3) cohort: campaigns with NO campaign_tracker_tasks rows. The
  // NOT EXISTS guard keeps the two cohorts mutually exclusive so a migrated
  // campaign (which has tracker rows) is never double-counted here. Otherwise
  // this is the unchanged pre-v3 digest over campaign_task.
  private fetchLegacyDigestRows(
    windowStart: Date,
    windowEnd: Date,
  ): Promise<DigestRow[]> {
    return this.client.$queryRaw<DigestRow[]>`
      WITH eligible AS (
        SELECT
          c.id,
          c.user_id,
          COUNT(*) FILTER (WHERE t.completed = true)::int  AS completed_count,
          COUNT(*) FILTER (WHERE t.completed = false)::int AS incomplete_count
        FROM campaign c
        JOIN campaign_task t ON t.campaign_id = c.id
        WHERE c.details->>'electionDate' ~ '^\\d{4}-\\d{2}-\\d{2}'
          AND (c.details->>'electionDate')::date > NOW()::date
          AND t.date >= ${windowStart}
          AND t.date < ${windowEnd}
          AND NOT EXISTS (
            SELECT 1 FROM campaign_tracker_tasks ctt
            WHERE ctt.campaign_id = c.id
          )
        GROUP BY c.id, c.user_id
        HAVING COUNT(*) FILTER (WHERE t.completed = false) >= ${MIN_TASKS}
      ),
      ranked_tasks AS (
        SELECT
          t.campaign_id,
          t.title,
          t.description,
          t.flow_type,
          t.date,
          t.week,
          ROW_NUMBER() OVER (
            PARTITION BY t.campaign_id
            ORDER BY
              CASE WHEN t.flow_type::text IN (${Prisma.join(OUTREACH_FLOW_TYPES)})
                THEN 0 ELSE 1 END,
              t.date ASC
          ) AS slot
        FROM campaign_task t
        JOIN eligible e ON e.id = t.campaign_id
        WHERE t.completed = false
          AND t.date >= ${windowStart}
          AND t.date < ${windowEnd}
      )
      SELECT
        e.id           AS campaign_id,
        e.user_id,
        e.completed_count,
        e.incomplete_count,
        rt.slot::int   AS slot,
        rt.title,
        rt.description,
        rt.flow_type,
        rt.date,
        rt.week
      FROM eligible e
      JOIN ranked_tasks rt ON rt.campaign_id = e.id
      WHERE rt.slot <= ${MAX_TASKS}
      ORDER BY e.id, rt.slot
    `
  }
}

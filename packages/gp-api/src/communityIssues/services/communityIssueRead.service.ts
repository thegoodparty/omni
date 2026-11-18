import { Injectable, NotFoundException } from '@nestjs/common'
import { isBefore, subHours } from 'date-fns'
import {
  AgentRunStatus,
  CommunityIssueList,
  ExperimentRunStatus,
  Prisma,
} from '../../generated/prisma'
import { runsOnGpApi } from '@/agents/agents.registry'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { toDateOnlyString } from 'src/shared/util/date.util'

// A run whose worker died mid-flight is left in a non-terminal status
// (QUEUED/RUNNING/AWAITING_RESUME/SUPERSEDED) forever. Left unguarded it reads
// as `running` indefinitely, which drives the client to poll without end. Any
// run still non-terminal this long after it started is treated as failed — well
// above real runtime (~10-20 min) but below any legitimate resume window.
const STALE_RUN_THRESHOLD_HOURS = 2

const EXPERIMENT_TYPE_FOR_LIST: Record<'top_community' | 'trending', string> = {
  top_community: 'top_community_issues',
  trending: 'trending_issues',
}

type RunStatus = 'running' | 'completed' | 'failed'

const RUN_STATUS_MAP: Record<ExperimentRunStatus, RunStatus> = {
  [ExperimentRunStatus.QUEUED]: 'running',
  [ExperimentRunStatus.RUNNING]: 'running',
  [ExperimentRunStatus.AWAITING_RESUME]: 'running',
  [ExperimentRunStatus.SUPERSEDED]: 'running',
  [ExperimentRunStatus.COMPLETED]: 'completed',
  [ExperimentRunStatus.FAILED]: 'failed',
}

const AGENT_RUN_STATUS_MAP: Record<AgentRunStatus, RunStatus> = {
  [AgentRunStatus.queued]: 'running',
  [AgentRunStatus.running]: 'running',
  [AgentRunStatus.superseded]: 'running',
  [AgentRunStatus.completed]: 'completed',
  [AgentRunStatus.failed]: 'failed',
}

type Refresh = { status: RunStatus; lastCompletedAt: string | null }

const TERMINAL_AGENT_RUNS = new Set<AgentRunStatus>([
  AgentRunStatus.completed,
  AgentRunStatus.failed,
])

// Absent means the list has never run, which the client polls as running.
const refreshOf = (
  latest: { status: RunStatus; createdAt: Date } | null,
  terminal: boolean,
  lastCompletedAt: Date | undefined,
): Refresh => ({
  status:
    latest === null
      ? 'running'
      : terminal
        ? latest.status
        : isBefore(
              latest.createdAt,
              subHours(new Date(), STALE_RUN_THRESHOLD_HOURS),
            )
          ? 'failed'
          : latest.status,
  lastCompletedAt: lastCompletedAt?.toISOString() ?? null,
})

type ArtifactItem = { item_id: string }
type ArtifactLike = {
  executive_summary?: { items?: ArtifactItem[] }
  items?: ArtifactItem[]
}

const extractItemIds = (artifact: Prisma.JsonValue): Set<string> => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const a = artifact as ArtifactLike // JSONB column; shape validated at write-time by the artifact validator
  const ids = new Set<string>()
  for (const item of a?.executive_summary?.items ?? []) {
    if (item.item_id) ids.add(item.item_id)
  }
  for (const item of a?.items ?? []) {
    if (item.item_id) ids.add(item.item_id)
  }
  return ids
}

@Injectable()
export class CommunityIssueReadService extends createPrismaBase(
  MODELS.CommunityIssue,
) {
  async listForOrg(
    organizationSlug: string,
    electedOfficeId: string,
    list: 'top_community' | 'trending',
  ) {
    const prismaList =
      list === 'top_community'
        ? CommunityIssueList.top_community
        : CommunityIssueList.trending

    const experimentType = EXPERIMENT_TYPE_FOR_LIST[list]
    // Whichever engine the switch sends this list's next run to is the one
    // whose runs the refresh state comes from: gp-api's own agents record
    // AgentRun, the PMF Engine records ExperimentRun.
    const [issues, refresh] = await Promise.all([
      this.model.findMany({
        where: { organizationSlug, list: prismaList, archivedAt: null },
        orderBy: { rank: Prisma.SortOrder.asc },
      }),
      runsOnGpApi(experimentType)
        ? this.agentRunRefresh(organizationSlug, experimentType, prismaList)
        : this.experimentRunRefresh(organizationSlug, experimentType),
    ])

    const issueIds = issues.map((i) => i.id)

    const priorities =
      issueIds.length > 0
        ? await this.client.priority.findMany({
            where: {
              electedOfficeId,
              sourceCommunityIssueId: { in: issueIds },
              archivedAt: null,
            },
            select: { sourceCommunityIssueId: true },
          })
        : []

    const prioritizedIds = new Set(
      priorities.map((p) => p.sourceCommunityIssueId),
    )

    return {
      issues: issues.map((issue) => ({
        id: issue.id,
        list: issue.list,
        category: issue.category,
        priority: issue.priority,
        title: issue.title,
        summary: issue.summary,
        rank: issue.rank,
        prioritized: prioritizedIds.has(issue.id),
      })),
      refresh,
    }
  }

  private async experimentRunRefresh(
    organizationSlug: string,
    experimentType: string,
  ): Promise<Refresh> {
    const [latestRun, latestCompletedRun] = await Promise.all([
      this.client.experimentRun.findFirst({
        where: { organizationSlug, experimentType },
        orderBy: { createdAt: Prisma.SortOrder.desc },
      }),
      this.client.experimentRun.findFirst({
        where: {
          organizationSlug,
          experimentType,
          status: ExperimentRunStatus.COMPLETED,
        },
        orderBy: { updatedAt: Prisma.SortOrder.desc },
      }),
    ])
    return refreshOf(
      latestRun && {
        status: RUN_STATUS_MAP[latestRun.status],
        createdAt: latestRun.createdAt,
      },
      latestRun?.status === ExperimentRunStatus.COMPLETED ||
        latestRun?.status === ExperimentRunStatus.FAILED,
      latestCompletedRun?.updatedAt,
    )
  }

  private async agentRunRefresh(
    organizationSlug: string,
    agentName: string,
    list: CommunityIssueList,
  ): Promise<Refresh> {
    const [latestRun, latestCompletedRun] = await Promise.all([
      this.client.agentRun.findFirst({
        where: { organizationSlug, agentName },
        orderBy: { createdAt: Prisma.SortOrder.desc },
      }),
      this.client.agentRun.findFirst({
        where: {
          organizationSlug,
          agentName,
          status: AgentRunStatus.completed,
        },
        orderBy: { updatedAt: Prisma.SortOrder.desc },
      }),
    ])
    // Cutover: the list last ran on the PMF Engine, so an org with no
    // AgentRun yet carries only the rows that run's ingest wrote, and the newest
    // of them is when the user's list last refreshed. Reporting it as completed
    // keeps the banner from polling a run that will never arrive. Removed at
    // teardown.
    if (latestRun === null) {
      const newestRow = await this.model.findFirst({
        where: {
          organizationSlug,
          list,
          archivedAt: null,
          // A starter row (communityIssueStarter) is not a run.
          lastRefreshedRunId: { not: null },
        },
        orderBy: { updatedAt: Prisma.SortOrder.desc },
        select: { updatedAt: true },
      })
      if (newestRow) {
        return refreshOf(
          { status: 'completed', createdAt: newestRow.updatedAt },
          true,
          newestRow.updatedAt,
        )
      }
    }
    return refreshOf(
      latestRun && {
        status: AGENT_RUN_STATUS_MAP[latestRun.status],
        createdAt: latestRun.createdAt,
      },
      latestRun !== null && TERMINAL_AGENT_RUNS.has(latestRun.status),
      latestCompletedRun?.updatedAt,
    )
  }

  async getDetailForOrg(
    id: string,
    organizationSlug: string,
    electedOfficeId: string,
  ) {
    // Deliberate (design §1): NO archivedAt filter here. Archived issues stay
    // resolvable so a prioritized-then-archived issue's source remains viewable
    // from the user's priorities. The response carries `archived` (below) so the
    // client surfaces the archived state instead of us returning a 404.
    const issue = await this.model.findFirst({
      where: { id, organizationSlug },
    })
    if (!issue) throw new NotFoundException('Community issue not found')

    const [directLinks, indirectPriority] = await Promise.all([
      this.client.meetingBriefingItemLink.findMany({
        where: { communityIssueId: id },
        include: { meetingBriefing: true },
      }),
      this.client.priority.findFirst({
        where: {
          sourceCommunityIssueId: id,
          electedOfficeId,
          archivedAt: null,
        },
        include: {
          briefingItemLinks: {
            include: { meetingBriefing: true },
          },
        },
      }),
    ])

    const allLinks = [...directLinks]
    if (indirectPriority) {
      for (const link of indirectPriority.briefingItemLinks) {
        const alreadyIncluded = allLinks.some(
          (l) =>
            l.meetingBriefingId === link.meetingBriefingId &&
            l.briefingItemId === link.briefingItemId,
        )
        if (!alreadyIncluded) allLinks.push(link)
      }
    }

    const validLinks = allLinks.filter((link) => {
      const artifact = link.meetingBriefing.artifact
      if (!artifact) return false
      const validIds = extractItemIds(artifact)
      return validIds.has(link.briefingItemId)
    })

    const relatedBriefings = validLinks.map((link) => ({
      meetingBriefingId: link.meetingBriefingId,
      briefingItemId: link.briefingItemId,
      meetingDate: toDateOnlyString(link.meetingBriefing.meetingDate) ?? '',
    }))

    return {
      id: issue.id,
      list: issue.list,
      category: issue.category,
      priority: issue.priority,
      title: issue.title,
      summary: issue.summary,
      rank: issue.rank,
      archived: issue.archivedAt !== null,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      detail: issue.detail as Record<string, unknown> | null, // JSONB column; opaque blob passed through to client unchanged
      relatedBriefings,
      prioritized: indirectPriority !== null,
      priorityId: indirectPriority?.id ?? null,
    }
  }
}

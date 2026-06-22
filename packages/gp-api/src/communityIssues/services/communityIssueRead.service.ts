import { Injectable, NotFoundException } from '@nestjs/common'
import {
  CommunityIssueList,
  ExperimentRunStatus,
  Prisma,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { toDateOnlyString } from 'src/shared/util/date.util'

const EXPERIMENT_TYPE_FOR_LIST: Record<'top_community' | 'trending', string> = {
  top_community: 'top_community_issues',
  trending: 'trending_issues',
}

const RUN_STATUS_MAP: Record<
  ExperimentRunStatus,
  'running' | 'completed' | 'failed'
> = {
  [ExperimentRunStatus.QUEUED]: 'running',
  [ExperimentRunStatus.RUNNING]: 'running',
  [ExperimentRunStatus.AWAITING_RESUME]: 'running',
  [ExperimentRunStatus.COMPLETED]: 'completed',
  [ExperimentRunStatus.FAILED]: 'failed',
}

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

    const [issues, latestRun, latestCompletedRun] = await Promise.all([
      this.model.findMany({
        where: { organizationSlug, list: prismaList, archivedAt: null },
        orderBy: { rank: Prisma.SortOrder.asc },
      }),
      this.client.experimentRun.findFirst({
        where: {
          organizationSlug,
          experimentType: EXPERIMENT_TYPE_FOR_LIST[list],
        },
        orderBy: { createdAt: Prisma.SortOrder.desc },
      }),
      this.client.experimentRun.findFirst({
        where: {
          organizationSlug,
          experimentType: EXPERIMENT_TYPE_FOR_LIST[list],
          status: ExperimentRunStatus.COMPLETED,
        },
        orderBy: { updatedAt: Prisma.SortOrder.desc },
      }),
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

    const runStatus = latestRun ? RUN_STATUS_MAP[latestRun.status] : 'running'
    const lastCompletedAt = latestCompletedRun
      ? latestCompletedRun.updatedAt.toISOString()
      : null

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
      refresh: { status: runStatus, lastCompletedAt },
    }
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

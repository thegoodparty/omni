import { Injectable } from '@nestjs/common'
import {
  CommunityIssueList,
  CommunityIssuePriority,
  ExperimentRun,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import {
  CommunityIssuesArtifact,
  CommunityIssuesArtifactIssue,
} from '../communityIssueArtifact.validation'

export type CommunityIssueUpsertSummary = {
  list: CommunityIssueList
  // True when the org had no rows for this list before this run and this run
  // created its first ones — i.e. the list's first-ever generation.
  wasFirstGenerationForList: boolean
  // Rows newly created (not refreshed) on the trending list with high priority.
  newHighPriorityTrending: { id: string; title: string; summary: string }[]
}

@Injectable()
export class CommunityIssueUpsertService extends createPrismaBase(
  MODELS.CommunityIssue,
) {
  async upsertFromArtifact(
    run: ExperimentRun,
    artifact: CommunityIssuesArtifact,
  ): Promise<CommunityIssueUpsertSummary | null> {
    const list =
      artifact.list === 'top_community'
        ? CommunityIssueList.top_community
        : CommunityIssueList.trending

    const existingCount = await this.model.count({
      where: { organizationSlug: artifact.organization_slug, list },
    })

    const idCarrying = artifact.issues.filter(
      (
        i,
      ): i is CommunityIssuesArtifactIssue & {
        existing_issue_id: string
      } => typeof i.existing_issue_id === 'string',
    )
    const idLess = artifact.issues.filter(
      (i) => typeof i.existing_issue_id !== 'string',
    )

    if (idCarrying.length > 0) {
      const rows = await this.model.findMany({
        where: {
          id: { in: idCarrying.map((i) => i.existing_issue_id) },
        },
        select: { id: true, organizationSlug: true, list: true },
      })
      const rowMap = new Map(rows.map((r) => [r.id, r]))
      for (const issue of idCarrying) {
        const row = rowMap.get(issue.existing_issue_id)
        if (!row) {
          this.logger.error(
            { runId: run.runId, existingIssueId: issue.existing_issue_id },
            'existing_issue_id not found — rejecting run',
          )
          return null
        }
        if (
          row.organizationSlug !== artifact.organization_slug ||
          row.list !== list
        ) {
          this.logger.error(
            {
              runId: run.runId,
              existingIssueId: issue.existing_issue_id,
              rowOrg: row.organizationSlug,
              rowList: row.list,
              artifactOrg: artifact.organization_slug,
              artifactList: list,
            },
            'existing_issue_id belongs to wrong org or list — rejecting run',
          )
          return null
        }
      }
    }

    const newHighPriorityTrending: CommunityIssueUpsertSummary['newHighPriorityTrending'] =
      []

    // Assumes at most one in-flight run per (org, list). Concurrent runs for the
    // same org+list could interleave archive-by-omission with the other's creates
    // under READ COMMITTED; the pipeline is agent-triggered so this is rare.
    await this.client.$transaction(async (tx) => {
      for (const issue of idCarrying) {
        await tx.communityIssue.update({
          where: { id: issue.existing_issue_id },
          data: {
            title: issue.title,
            summary: issue.summary,
            category: issue.category,
            priority: issue.priority,
            detail: issue.detail as object,
            rank: issue.rank,
            archivedAt: null,
            lastRefreshedRunId: run.runId,
          },
        })
      }

      const updatedIds = new Set(idCarrying.map((i) => i.existing_issue_id))
      for (const issue of idLess) {
        const created = await tx.communityIssue.create({
          data: {
            organizationSlug: artifact.organization_slug,
            list,
            category: issue.category,
            priority: issue.priority,
            title: issue.title,
            summary: issue.summary,
            detail: issue.detail as object,
            rank: issue.rank,
            lastRefreshedRunId: run.runId,
          },
        })
        updatedIds.add(created.id)
        if (
          list === CommunityIssueList.trending &&
          issue.priority === CommunityIssuePriority.high
        ) {
          newHighPriorityTrending.push({
            id: created.id,
            title: issue.title,
            summary: issue.summary,
          })
        }
      }

      await tx.communityIssue.updateMany({
        where: {
          organizationSlug: artifact.organization_slug,
          list,
          archivedAt: null,
          id: { notIn: [...updatedIds] },
        },
        data: { archivedAt: new Date() },
      })
    })

    return {
      list,
      wasFirstGenerationForList: existingCount === 0 && idLess.length > 0,
      newHighPriorityTrending,
    }
  }
}

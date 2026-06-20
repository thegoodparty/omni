import { Injectable } from '@nestjs/common'
import { MeetingBriefingFull } from '@/generated/agent-job-contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'

type LinkRow = {
  briefingItemId: string
  priorityId: string | null
  communityIssueId: string | null
}

@Injectable()
export class BriefingItemLinksService extends createPrismaBase(
  MODELS.MeetingBriefingItemLink,
) {
  async syncLinksFromArtifact(
    meetingBriefingId: string,
    organizationSlug: string,
    artifact: MeetingBriefingFull,
  ): Promise<void> {
    const items = artifact.executive_summary?.items
    if (!items || items.length === 0) {
      await this.client.$transaction([
        this.model.deleteMany({ where: { meetingBriefingId } }),
      ])
      return
    }

    const electedOffice = await this.client.electedOffice.findUnique({
      where: { organizationSlug },
      select: { id: true },
    })

    if (!electedOffice) {
      this.logger.warn(
        { meetingBriefingId, organizationSlug },
        'briefingItemLinks: no ElectedOffice found for org — skipping link sync',
      )
      return
    }

    const candidates = await this.buildCandidates(
      items,
      electedOffice.id,
      organizationSlug,
      meetingBriefingId,
    )

    await this.client.$transaction([
      this.model.deleteMany({ where: { meetingBriefingId } }),
      ...candidates.map((c) =>
        this.model.create({
          data: {
            meetingBriefingId,
            briefingItemId: c.briefingItemId,
            priorityId: c.priorityId,
            communityIssueId: c.communityIssueId,
          },
        }),
      ),
    ])
  }

  private async buildCandidates(
    items: MeetingBriefingFull['executive_summary']['items'],
    electedOfficeId: string,
    organizationSlug: string,
    meetingBriefingId: string,
  ): Promise<LinkRow[]> {
    const candidates: LinkRow[] = []
    for (const item of items) {
      const rawPriorityId = item.priority_id
      const rawCommunityIssueId = item.community_issue_id

      if (!rawPriorityId && !rawCommunityIssueId) continue

      const priorityId = await this.validatePriorityId(
        rawPriorityId,
        electedOfficeId,
        { itemId: item.item_id, meetingBriefingId, organizationSlug },
      )
      const communityIssueId = await this.validateFeedId(
        rawCommunityIssueId,
        organizationSlug,
        item.item_id,
        meetingBriefingId,
      )

      if (priorityId || communityIssueId) {
        candidates.push({
          briefingItemId: item.item_id,
          priorityId,
          communityIssueId,
        })
      }
    }
    return candidates
  }

  private async validatePriorityId(
    rawId: string | undefined,
    electedOfficeId: string,
    ctx: {
      itemId: string
      meetingBriefingId: string
      organizationSlug: string
    },
  ): Promise<string | null> {
    if (!rawId) return null
    const row = await this.client.priority.findFirst({
      where: { id: rawId, electedOfficeId },
      select: { id: true },
    })
    if (!row) {
      this.logger.warn(
        { ...ctx, priorityId: rawId },
        'briefingItemLinks: priority_id failed org validation — dropping',
      )
      return null
    }
    return row.id
  }

  private async validateFeedId(
    rawId: string | undefined,
    organizationSlug: string,
    itemId: string,
    meetingBriefingId: string,
  ): Promise<string | null> {
    if (!rawId) return null
    const row = await this.client.communityIssue.findFirst({
      where: { id: rawId, organizationSlug },
      select: { id: true },
    })
    if (!row) {
      this.logger.warn(
        {
          meetingBriefingId,
          organizationSlug,
          itemId,
          communityIssueId: rawId,
        },
        'briefingItemLinks: community_issue_id failed org validation — dropping',
      )
      return null
    }
    return row.id
  }
}

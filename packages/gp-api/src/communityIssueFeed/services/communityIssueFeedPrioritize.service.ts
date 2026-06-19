import { Injectable, NotFoundException } from '@nestjs/common'
import { PrioritySource } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'

@Injectable()
export class CommunityIssueFeedPrioritizeService extends createPrismaBase(
  MODELS.CommunityIssueFeed,
) {
  async prioritize(issueId: string, electedOfficeId: string) {
    const issue = await this.model.findUnique({ where: { id: issueId } })
    if (!issue) throw new NotFoundException('Community issue not found')

    const existing = await this.client.priority.findFirst({
      where: {
        sourceCommunityIssueFeedId: issueId,
        electedOfficeId,
      },
    })
    if (existing) return existing

    return this.client.priority.create({
      data: {
        electedOfficeId,
        title: issue.title,
        description: issue.summary,
        source: PrioritySource.community_issue_feed,
        sourceCommunityIssueFeedId: issueId,
      },
    })
  }
}

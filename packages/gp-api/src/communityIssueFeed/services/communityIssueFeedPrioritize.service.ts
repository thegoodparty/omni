import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, PrioritySource } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'

@Injectable()
export class CommunityIssueFeedPrioritizeService extends createPrismaBase(
  MODELS.CommunityIssueFeed,
) {
  async prioritize(
    issueId: string,
    organizationSlug: string,
    electedOfficeId: string,
  ) {
    const issue = await this.model.findFirst({
      where: { id: issueId, organizationSlug },
    })
    if (!issue) throw new NotFoundException('Community issue not found')
    if (issue.archivedAt !== null)
      throw new BadRequestException('Cannot prioritize an archived issue')

    try {
      return await this.client.priority.create({
        data: {
          electedOfficeId,
          title: issue.title,
          description: issue.summary,
          source: PrioritySource.community_issue_feed,
          sourceCommunityIssueFeedId: issueId,
        },
      })
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return this.client.priority.findFirstOrThrow({
          where: { sourceCommunityIssueFeedId: issueId, electedOfficeId },
        })
      }
      throw e
    }
  }
}

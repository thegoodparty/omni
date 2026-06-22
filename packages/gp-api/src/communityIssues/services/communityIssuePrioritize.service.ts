import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma, PrioritySource } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'

@Injectable()
export class CommunityIssuePrioritizeService extends createPrismaBase(
  MODELS.CommunityIssue,
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
    // Deliberate (design §3): the fetch above does NOT filter archivedAt, so an
    // archived issue resolves here and returns 400 (not a 404) — you cannot
    // prioritize a resolved/archived issue. Active issues fall through.
    if (issue.archivedAt !== null)
      throw new BadRequestException('Cannot prioritize an archived issue')

    try {
      return await this.client.priority.create({
        data: {
          electedOfficeId,
          title: issue.title,
          description: issue.summary,
          source: PrioritySource.community_issue,
          sourceCommunityIssueId: issueId,
        },
      })
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return this.client.priority.findFirstOrThrow({
          where: { sourceCommunityIssueId: issueId, electedOfficeId },
        })
      }
      throw e
    }
  }
}

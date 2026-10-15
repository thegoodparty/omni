import { BadRequestException, Injectable } from '@nestjs/common'
import {
  ElectedOffice,
  OutreachStatus,
  OutreachType,
  PollConfidence,
  Prisma,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { APIPollStatus, derivePollStatus } from '../polls.types'

@Injectable()
export class PollsService extends createPrismaBase(MODELS.Poll) {
  async update(args: Prisma.PollUpdateArgs) {
    return this.model.update(args)
  }

  async delete(args: Prisma.PollDeleteArgs) {
    return this.model.delete(args)
  }

  // A poll outreach still `pending_payment` is an unsubmitted draft, so it
  // does not count as the official having a poll.
  async hasPolls(
    electedOffice: Pick<ElectedOffice, 'id' | 'organizationSlug'>,
  ): Promise<boolean> {
    const [poll, outreachPoll] = await Promise.all([
      this.model.findFirst({
        where: { electedOfficeId: electedOffice.id },
        take: 1,
      }),
      this.client.outreach.findFirst({
        where: {
          organizationSlug: electedOffice.organizationSlug,
          outreachType: OutreachType.poll,
          status: { not: OutreachStatus.pending_payment },
        },
        select: { id: true },
      }),
    ])
    return poll !== null || outreachPoll !== null
  }

  async markPollComplete(params: {
    pollId: string
    totalResponses: number
    confidence: PollConfidence
  }) {
    return this.optimisticLockingUpdate(
      { where: { id: params.pollId } },
      (poll) => {
        // We want to allow completing scheduled polls for testing purposes. In E2E tests
        // we create polls and want to simulate completing them quickly.
        if (
          ![APIPollStatus.SCHEDULED, APIPollStatus.IN_PROGRESS].includes(
            derivePollStatus(poll),
          )
        ) {
          throw new BadRequestException('Poll is not in-progress')
        }

        return {
          isCompleted: true,
          confidence: params.confidence,
          responseCount: params.totalResponses,
          completedDate: new Date(),
        }
      },
    )
  }
}

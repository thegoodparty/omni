import { addBusinessDays } from 'date-fns'
import { BadRequestException, Injectable } from '@nestjs/common'
import { PollConfidence, Prisma } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { QueueProducerService } from 'src/queue/producer/queueProducer.service'
import { QueueType } from 'src/queue/queue.types'
import { pollMessageGroup } from '../utils/polls.utils'
import { APIPollStatus, derivePollStatus } from '../polls.types'
import { DashboardCardsService } from '@/dashboardCards/services/dashboardCards.service'

type PollCreateInput = Omit<
  Prisma.PollCreateInput,
  'estimatedCompletionDate' | 'electedOffice' | 'issues' | 'individualMessages'
> & {
  electedOfficeId: string
}

const estimatedCompletionDate = (scheduledDate: Date | string) =>
  addBusinessDays(scheduledDate, 3)

@Injectable()
export class PollsService extends createPrismaBase(MODELS.Poll) {
  constructor(
    private readonly queueProducer: QueueProducerService,
    private readonly dashboardCards: DashboardCardsService,
  ) {
    super()
  }

  async create(input: PollCreateInput) {
    const poll = await this.client.poll.create({
      data: {
        ...input,
        estimatedCompletionDate: estimatedCompletionDate(input.scheduledDate),
      },
    })
    await this.queueProducer.sendMessage(
      { type: QueueType.POLL_CREATION, data: { pollId: poll.id } },
      pollMessageGroup(poll.id),
    )

    return poll
  }

  async update(args: Prisma.PollUpdateArgs) {
    return this.model.update(args)
  }

  async delete(args: Prisma.PollDeleteArgs) {
    return this.model.delete(args)
  }

  async hasPolls(electedOfficeId: string): Promise<boolean> {
    const poll = await this.model.findFirst({
      where: { electedOfficeId },
      take: 1,
    })
    return poll !== null
  }

  async markPollComplete(params: {
    pollId: string
    totalResponses: number
    confidence: PollConfidence
  }) {
    const poll = await this.optimisticLockingUpdate(
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

    // The results landing is a heads-up the official should see wherever they
    // are, so it becomes a notification. Deliberately after the update rather
    // than inside it: the card is a side effect, and a card write failing must
    // not roll back a poll that genuinely completed.
    await this.dashboardCards.syncFromPoll(poll)

    return poll
  }

  async expandPoll(params: {
    pollId: string
    additionalRecipientCount: number
    scheduledDate: Date
  }) {
    const result = await this.optimisticLockingUpdate(
      { where: { id: params.pollId } },
      (poll) => {
        if (derivePollStatus(poll) !== APIPollStatus.COMPLETED) {
          throw new BadRequestException('Poll is not completed')
        }

        return {
          isCompleted: false,
          scheduledDate: params.scheduledDate,
          estimatedCompletionDate: estimatedCompletionDate(
            params.scheduledDate,
          ),
          targetAudienceSize:
            poll.targetAudienceSize + params.additionalRecipientCount,
        }
      },
    )

    await this.queueProducer.sendMessage(
      { type: QueueType.POLL_EXPANSION, data: { pollId: params.pollId } },
      pollMessageGroup(params.pollId),
    )

    return result
  }
}

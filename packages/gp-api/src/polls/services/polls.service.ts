import { addBusinessDays } from 'date-fns'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PollConfidence, Prisma } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { JobsService } from '@/jobs/jobs.service'
import { retryIf } from '@/shared/util/retry-if'
import { pollMessageGroup } from '../utils/polls.utils'
import { APIPollStatus, derivePollStatus } from '../polls.types'

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
  constructor(private readonly jobs: JobsService) {
    super()
  }

  // The pollCreation job commits with the poll, so every poll is sent and a
  // poll that failed to insert never is.
  async create(input: PollCreateInput) {
    return this.client.$transaction(async (tx) => {
      const poll = await tx.poll.create({
        data: {
          ...input,
          estimatedCompletionDate: estimatedCompletionDate(input.scheduledDate),
        },
      })
      await this.jobs.send(
        'pollCreation',
        { pollId: poll.id },
        { group: pollMessageGroup(poll.id), tx },
      )
      return poll
    })
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

  // The optimistic update of optimisticLockingUpdate, inside a transaction
  // so the pollExpansion job commits with the expansion it texts. A refused
  // caller (pollPurchase.service.ts) sends nothing, so a send lost after the
  // update could never be retried.
  async expandPoll(params: {
    pollId: string
    additionalRecipientCount: number
    scheduledDate: Date
    checkoutSessionId: string
  }) {
    return retryIf(
      (_, attempt) =>
        this.client.$transaction(async (tx) => {
          const poll = await tx.poll.findUnique({
            where: { id: params.pollId },
          })
          if (!poll) {
            throw new NotFoundException(`Poll not found: ${params.pollId}`)
          }
          // Checked before the status so one checkout can never expand a poll
          // twice, even once the expansion it paid for has completed.
          if (poll.expansionCheckoutSessionId === params.checkoutSessionId) {
            throw new BadRequestException(
              'Poll already expanded by this checkout',
            )
          }
          if (derivePollStatus(poll) !== APIPollStatus.COMPLETED) {
            throw new BadRequestException('Poll is not completed')
          }

          const [updated] = await tx.poll.updateManyAndReturn({
            where: { id: poll.id, updatedAt: poll.updatedAt },
            data: {
              isCompleted: false,
              scheduledDate: params.scheduledDate,
              estimatedCompletionDate: estimatedCompletionDate(
                params.scheduledDate,
              ),
              targetAudienceSize:
                poll.targetAudienceSize + params.additionalRecipientCount,
              expansionCheckoutSessionId: params.checkoutSessionId,
              updatedAt: new Date(),
            },
          })
          if (!updated) {
            throw new ConflictException(
              `Poll ${poll.id} changed while expanding, attempt ${attempt}`,
            )
          }

          await this.jobs.send(
            'pollExpansion',
            { pollId: poll.id },
            { group: pollMessageGroup(poll.id), tx },
          )
          return updated
        }),
      {
        shouldRetry: (error) => error instanceof ConflictException,
        retries: 5,
        factor: 1.5,
        minTimeout: 100,
      },
    )
  }
}

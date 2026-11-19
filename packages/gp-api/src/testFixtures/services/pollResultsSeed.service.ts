import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { addBusinessDays, subDays } from 'date-fns'
import { v7 as uuidv7 } from 'uuid'
import type {
  SeedPollResultsRequest,
  SeedPollResultsResponse,
} from '@goodparty_org/contracts'
import { PollConfidence, PollIndividualMessageSender } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

// The poll name every real poll gets (PollsController.createInitialPoll).
const POLL_NAME = 'Top Community Issues'

// Writes the rows a finished poll leaves behind for one constituent: the poll,
// one issue, the office's outbound message and the constituent's reply tagged
// with that issue. These are the rows the pollAnalysisComplete consumer writes
// from the analysis pipeline, which a PR preview never runs, so a spec of what
// the contacts overlay shows for a poll respondent can run on a preview.
@Injectable()
export class PollResultsSeedService extends createPrismaBase(MODELS.Poll) {
  async seed(
    electedOfficeId: string,
    { personId, issueTitle, issueSummary }: SeedPollResultsRequest,
  ): Promise<SeedPollResultsResponse> {
    const now = new Date()
    const scheduledDate = subDays(now, 4)
    const pollId = uuidv7()

    await this.client.$transaction(async (tx) => {
      await tx.poll.create({
        data: {
          id: pollId,
          name: POLL_NAME,
          messageContent: 'What is the most important issue in our community?',
          electedOfficeId,
          targetAudienceSize: 1,
          responseCount: 1,
          confidence: PollConfidence.LOW,
          scheduledDate,
          estimatedCompletionDate: addBusinessDays(scheduledDate, 3),
          completedDate: now,
          isCompleted: true,
        },
      })
      await tx.pollIssue.create({
        data: {
          id: `${pollId}-1`,
          pollId,
          title: issueTitle,
          summary: issueSummary,
          details: issueSummary,
          mentionCount: 1,
          representativeComments: [],
        },
      })
      await tx.pollIndividualMessage.create({
        data: {
          id: randomUUID(),
          personId,
          sentAt: scheduledDate,
          sender: PollIndividualMessageSender.ELECTED_OFFICIAL,
          electedOfficeId,
          pollId,
        },
      })
      await tx.pollIndividualMessage.create({
        data: {
          id: randomUUID(),
          personId,
          sentAt: subDays(now, 1),
          sender: PollIndividualMessageSender.CONSTITUENT,
          content: `Response about ${issueTitle}`,
          isOptOut: false,
          electedOfficeId,
          pollId,
          pollIssues: { connect: { id: `${pollId}-1` } },
        },
      })
    })

    return { pollId, pollName: POLL_NAME }
  }
}

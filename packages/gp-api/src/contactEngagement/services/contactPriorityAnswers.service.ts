import { Injectable } from '@nestjs/common'
import { Prisma, PriorityAnswerSource } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import type {
  ConstituentPriorityAnswer,
  PersonPriorityAnswer,
} from '../contactEngagement.types'

const WITH_PRIORITY = {
  outreach: {
    select: { priority: { select: { id: true, title: true } } },
  },
} satisfies Prisma.PriorityAnswerInclude

type AnswerWithPriority = Prisma.PriorityAnswerGetPayload<{
  include: typeof WITH_PRIORITY
}>

type AnsweredPriority = AnswerWithPriority & {
  outreach: { priority: { id: string; title: string } }
}

const hasPriority = (answer: AnswerWithPriority): answer is AnsweredPriority =>
  answer.outreach.priority !== null

const toAnswer = (answer: AnsweredPriority): ConstituentPriorityAnswer => ({
  priorityId: answer.outreach.priority.id,
  priorityTitle: answer.outreach.priority.title,
  answer: answer.code,
})

// What one person said to a priority's check, read off the coded rows in
// priorities/ (an AI's reading of a text reply or a call/door memo). A send
// whose priority was since deleted has nothing to link or name, so it is
// left out.
@Injectable()
export class ContactPriorityAnswersService extends createPrismaBase(
  MODELS.PriorityAnswer,
) {
  private async forPerson(
    organizationSlug: string,
    personId: string,
  ): Promise<AnsweredPriority[]> {
    const rows = await this.model.findMany({
      where: { organizationSlug, personId },
      include: WITH_PRIORITY,
      orderBy: [{ createdAt: Prisma.SortOrder.desc }, { id: 'desc' }],
    })
    return rows.filter(hasPriority)
  }

  async list(
    organizationSlug: string,
    personId: string,
  ): Promise<PersonPriorityAnswer[]> {
    const rows = await this.forPerson(organizationSlug, personId)
    return rows.map((row) => ({
      id: row.id,
      source: row.source,
      ...toAnswer(row),
    }))
  }

  // A text's answer is keyed by its send, a call's or a knock's by the
  // interaction row, matching how each was coded.
  async forFeed(
    organizationSlug: string,
    personId: string,
  ): Promise<{
    byTextOutreachId: Map<number, ConstituentPriorityAnswer>
    byInteractionId: Map<string, ConstituentPriorityAnswer>
  }> {
    const rows = await this.forPerson(organizationSlug, personId)
    const byTextOutreachId = new Map<number, ConstituentPriorityAnswer>()
    const byInteractionId = new Map<string, ConstituentPriorityAnswer>()
    for (const row of rows) {
      if (row.source === PriorityAnswerSource.text) {
        byTextOutreachId.set(row.outreachId, toAnswer(row))
      } else {
        byInteractionId.set(row.sourceId, toAnswer(row))
      }
    }
    return { byTextOutreachId, byInteractionId }
  }
}

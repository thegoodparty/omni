import { randomUUID } from 'node:crypto'
import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type {
  SeedFeedbackRequest,
  SeedFeedbackResponse,
} from '@goodparty_org/contracts'
import {
  ConstituentFeedbackCaptureMethod,
  ConstituentFeedbackChannel,
  ConstituentFeedbackExtractionStatus,
  DoorKnockOutcome,
  PhoneBankCallOutcome,
  Prisma,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { SEED_MEMOS, type SeedMemo } from './feedbackSeedMemos'

// A write seam into customer-shaped data, so it must never be reachable on
// prod. Same gate as the community issues seed: OTEL_SERVICE_ENVIRONMENT
// names the deploy (NODE_ENV is 'production' in every image), an unknown
// value fails closed, and unset means local or vitest. Read live so a test
// can stub it.
const SEED_ENABLED_ENVIRONMENTS = new Set(['local', 'test', 'preview', 'dev'])

const isSeedEnabled = () => {
  const env = process.env.OTEL_SERVICE_ENVIRONMENT
  return env === undefined || SEED_ENABLED_ENVIRONMENTS.has(env)
}

// Hundreds of sequential inserts; the interactive default of 5s is too
// tight on a busy laptop.
const SEED_TRANSACTION_TIMEOUT_MS = 60_000

const SEED_MODEL = 'seed'

// Fake confirmed memos on an existing effort, each on an answered knock or
// call, so the report can be read at 5, 20, 40 and 80 memos without a
// canvass. Dev only.
@Injectable()
export class FeedbackSeedService extends createPrismaBase(
  MODELS.ConstituentFeedback,
) {
  async seed(input: {
    organizationSlug: string
    actorUserId: number
    body: SeedFeedbackRequest
  }): Promise<SeedFeedbackResponse> {
    // 404, not 403: on prod the route should not admit it exists.
    if (!isSeedEnabled()) throw new NotFoundException()

    const { organizationSlug, body } = input
    const effort = await this.client.outreach.findFirst({
      where: { id: body.outreachId, organizationSlug },
      select: {
        id: true,
        doorKnockingTurf: {
          select: { id: true, communityInputQuestion: true },
        },
        phoneBankingList: {
          select: { id: true, communityInputQuestion: true },
        },
      },
    })
    if (effort === null) throw new NotFoundException('Effort not found')

    const context = {
      organizationSlug,
      actorUserId: input.actorUserId,
      outreachId: effort.id,
    }
    const created = effort.doorKnockingTurf
      ? await this.seedTurf(context, body.count, effort.doorKnockingTurf)
      : effort.phoneBankingList
        ? await this.seedList(context, body.count, effort.phoneBankingList)
        : null
    if (created === null) throw new NotFoundException('Effort not found')

    return { outreachId: effort.id, created }
  }

  private async seedTurf(
    context: SeedContext,
    count: number,
    turf: { id: number; communityInputQuestion: string | null },
  ): Promise<number> {
    const targets = await this.client.doorKnockingStopTarget.findMany({
      where: { stop: { doorKnockingTurfId: turf.id } },
      select: { personId: true },
      orderBy: { id: Prisma.SortOrder.asc },
    })
    if (targets.length === 0) {
      throw new UnprocessableEntityException('This turf has no one on it')
    }

    await this.client.$transaction(
      async (tx) => {
        for (let i = 0; i < count; i++) {
          const { personId } = targets[i % targets.length]!
          const knock = await tx.contactInteractionDoorKnock.create({
            data: {
              organizationSlug: context.organizationSlug,
              personId,
              occurredAt: new Date(),
              outcome: DoorKnockOutcome.answered,
              sourceId: randomUUID(),
              actorUserId: context.actorUserId,
              outreachId: context.outreachId,
            },
          })
          await tx.constituentFeedback.create({
            data: {
              ...memoRow(context, i, turf.communityInputQuestion),
              personId,
              channel: ConstituentFeedbackChannel.door_knock,
              doorKnockInteractionId: knock.id,
            },
          })
        }
      },
      { timeout: SEED_TRANSACTION_TIMEOUT_MS },
    )
    return count
  }

  // A call row is unique per (list, person) and a memo per call, so a list
  // takes one seeded memo per person who has none yet.
  private async seedList(
    context: SeedContext,
    count: number,
    list: { id: number; communityInputQuestion: string | null },
  ): Promise<number> {
    const [people, memoed] = await Promise.all([
      this.client.phoneBankingListEntryPerson.findMany({
        where: { entry: { phoneBankingListId: list.id } },
        select: { personId: true },
        orderBy: { id: Prisma.SortOrder.asc },
      }),
      this.findMany({
        where: { phoneBankingInteraction: { phoneBankingListId: list.id } },
        select: { personId: true },
      }),
    ])
    if (people.length === 0) {
      throw new UnprocessableEntityException('This list has no one on it')
    }
    const taken = new Set(memoed.map((row) => row.personId))
    const available = [
      ...new Set(people.map((person) => person.personId)),
    ].filter((personId) => !taken.has(personId))
    const chosen = available.slice(0, count)

    await this.client.$transaction(
      async (tx) => {
        for (const [i, personId] of chosen.entries()) {
          const answered = {
            organizationSlug: context.organizationSlug,
            occurredAt: new Date(),
            outcome: PhoneBankCallOutcome.answered,
            actorUserId: context.actorUserId,
          }
          const call = await tx.contactInteractionPhoneBanking.upsert({
            where: {
              phoneBankingListId_personId: {
                phoneBankingListId: list.id,
                personId,
              },
            },
            create: { ...answered, phoneBankingListId: list.id, personId },
            update: answered,
          })
          await tx.constituentFeedback.create({
            data: {
              ...memoRow(context, i, list.communityInputQuestion),
              personId,
              channel: ConstituentFeedbackChannel.phone_bank,
              phoneBankingInteractionId: call.id,
            },
          })
        }
      },
      { timeout: SEED_TRANSACTION_TIMEOUT_MS },
    )
    return chosen.length
  }
}

type SeedContext = {
  organizationSlug: string
  actorUserId: number
  outreachId: number
}

// Confirmed as recorded: the proposed columns match the confirmed ones, so
// a seeded memo reads as one the canvasser accepted without edits.
const memoRow = (
  context: SeedContext,
  index: number,
  effortQuestion: string | null,
) => {
  const memo: SeedMemo = SEED_MEMOS[index % SEED_MEMOS.length]!
  const now = new Date()
  return {
    organizationSlug: context.organizationSlug,
    actorUserId: context.actorUserId,
    outreachId: context.outreachId,
    occurredAt: now,
    confirmedAt: now,
    clientKey: randomUUID(),
    transcript: memo.transcript,
    captureMethod: ConstituentFeedbackCaptureMethod.typed,
    issueLabel: memo.issueLabel,
    stance: memo.stance,
    desiredOutcome: memo.desiredOutcome,
    extractionStatus: ConstituentFeedbackExtractionStatus.extracted,
    extractionModel: SEED_MODEL,
    proposedIssueLabel: memo.issueLabel,
    proposedStance: memo.stance,
    proposedDesiredOutcome: memo.desiredOutcome,
    effortQuestion,
  }
}

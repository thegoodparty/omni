import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { Cron } from '@nestjs/schedule'
import {
  OutreachStatus,
  OutreachType,
  PriorityAnswerCode,
  Prisma,
  type Organization,
} from '@/generated/prisma'
import { ContactsService } from '@/contacts/services/contacts.service'
import {
  batchTargets,
  batchWeights,
  splitBatch,
} from '@/contacts/utils/civicPanelAllocation.util'
import { CronLockService } from '@/cron/services/cronLock.service'
import { roundTwoDrawCutoff } from '@/outreach/services/outreachServeSmsCreate.service'
import type { SampleWeights } from '@/peopleDb/schemas/people.schema'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { MessageGroup, QueueType } from '@/queue/queue.types'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { raceNameable } from '../util/censusWeighting.util'
import { fitMrp, poststratify } from '../util/mrp.util'
import {
  roundTwoAnswers,
  roundTwoDimensions,
  roundTwoFrame,
  UNDRAWN_SAMPLE_WHERE,
  unionDraws,
  type CodedCells,
} from '../util/roundTwo.util'
import { roundTwoExclusions } from '../util/roundTwoExclusions.util'
import {
  CENSUS_COMPOSITION_SOURCE,
  type CensusCompositionSource,
} from './censusComposition'

const DRAW_JOB = 'priorityRoundTwoDraw'
const DRAW_CRON = '41 7 * * *'

// The send's first and only delivery, as the purchase handler enqueues any
// other Serve text.
const SEND_SEQ = 1

// A paid round 2 text whose list has not been drawn.
const UNDRAWN_ROUND_TWO_WHERE = {
  outreachType: OutreachType.text,
  campaignId: null,
  organizationSlug: { not: null },
  priorityId: { not: null },
  status: OutreachStatus.pending,
  voterFileFilter: UNDRAWN_SAMPLE_WHERE,
} satisfies Prisma.OutreachWhereInput

const CODED = [
  PriorityAnswerCode.yes,
  PriorityAnswerCode.no,
  PriorityAnswerCode.mixed,
] as const

export interface RoundTwoDrawResult {
  drawn: boolean
  recipientCount: number
}

const NOT_DRAWN: RoundTwoDrawResult = { drawn: false, recipientCount: 0 }

// Draws a priority's round 2 text on the last day staff can still take it:
// fits the model to the priority's coded answers, leans most of the send
// toward the groups it is least sure about and draws the rest unsteered,
// freezes who was drawn onto the send's list, and hands the send off the way
// a paid Serve text is handed off at checkout. See
// docs/features/civic-panel-mrp.md.
@Injectable()
export class PriorityRoundTwoDrawService extends createPrismaBase(
  MODELS.Outreach,
) {
  constructor(
    private readonly moduleRef: ModuleRef,
    @Inject(CENSUS_COMPOSITION_SOURCE)
    private readonly census: CensusCompositionSource,
    private readonly cronLock: CronLockService,
    private readonly queueProducer: QueueProducerService,
  ) {
    super()
  }

  @Cron(DRAW_CRON, { name: DRAW_JOB, timeZone: EASTERN_TIMEZONE })
  async drawDue(now: Date = new Date()): Promise<void> {
    const due = await this.model.findMany({
      where: {
        ...UNDRAWN_ROUND_TWO_WHERE,
        scheduledLocalDate: { lte: roundTwoDrawCutoff(now) },
      },
      select: { id: true },
    })
    if (due.length === 0) return
    if (!(await this.cronLock.tryClaimDailyRun(DRAW_JOB, now))) return
    try {
      for (const { id } of due) {
        try {
          await this.draw(id)
        } catch (err) {
          this.logger.error(
            { err, outreachId: id },
            'Round 2 draw failed; released for the next run',
          )
        }
      }
    } finally {
      await this.cronLock.markCompleted(DRAW_JOB, now)
    }
  }

  async drawForOffice(
    organizationSlug: string,
    outreachId: number,
  ): Promise<RoundTwoDrawResult> {
    const send = await this.model.findFirst({
      where: { id: outreachId, organizationSlug, campaignId: null },
      select: { id: true },
    })
    if (!send) throw new NotFoundException('Outreach not found')
    return this.draw(outreachId)
  }

  // Safe to call again: the claim on the list's `sampledAt` lets one caller
  // draw, and a send already drawn is left alone.
  async draw(outreachId: number): Promise<RoundTwoDrawResult> {
    const send = await this.model.findFirst({
      where: { id: outreachId, ...UNDRAWN_ROUND_TWO_WHERE },
      select: {
        priorityId: true,
        textCount: true,
        organization: true,
        voterFileFilter: { include: { activityConditions: true } },
      },
    })
    if (!send?.organization || !send.voterFileFilter || !send.priorityId) {
      return NOT_DRAWN
    }
    const { organization, voterFileFilter: list, priorityId } = send
    const size = send.textCount ?? list.sampleSize ?? 0

    const claimed = await this.client.voterFileFilter.updateMany({
      where: { id: list.id, ...UNDRAWN_SAMPLE_WHERE },
      data: { sampledAt: new Date() },
    })
    if (claimed.count === 0) return NOT_DRAWN

    // Any failure from the claim to the handoff puts the list back to
    // undrawn, so the next run draws it again rather than leaving a paid
    // send claimed with no one on it.
    let personIds: string[]
    try {
      personIds = await this.pick(outreachId, organization, priorityId, size, {
        ...list,
        sampleSize: null,
        hasCellPhone: true,
      })
      await this.client.voterFileFilterSampleMember.createMany({
        data: personIds.map((personId) => ({
          voterFileFilterId: list.id,
          personId,
        })),
        skipDuplicates: true,
      })
    } catch (err) {
      await this.release(list.id)
      throw err
    }

    // Nobody left to text: nothing to hand off, and drawing again tomorrow
    // finds the same nobody. The send is paid, so staff refund it.
    if (personIds.length === 0) {
      this.logger.error(
        { outreachId, requested: size },
        'Round 2 drew nobody; the paid send was not handed off',
      )
      return { drawn: true, recipientCount: 0 }
    }
    if (personIds.length < size) {
      this.logger.warn(
        { outreachId, requested: size, delivered: personIds.length },
        'Round 2 drew fewer people than were paid for',
      )
    }

    try {
      await this.queueProducer.sendMessage(
        {
          type: QueueType.OUTREACH_TEXT_SEND,
          data: { outreachId, sendSeq: SEND_SEQ },
        },
        `${MessageGroup.outreachTextSend}-${outreachId}`,
        {
          throwOnError: true,
          deduplicationId: `${QueueType.OUTREACH_TEXT_SEND}-${outreachId}-${SEND_SEQ}`,
        },
      )
    } catch (err) {
      await this.release(list.id)
      throw err
    }
    this.logger.info(
      { outreachId, recipientCount: personIds.length },
      'Round 2 drawn and handed off',
    )
    return { drawn: true, recipientCount: personIds.length }
  }

  // Back to undrawn, so the next run draws it again.
  private async release(voterFileFilterId: number): Promise<void> {
    await this.client.$transaction([
      this.client.voterFileFilterSampleMember.deleteMany({
        where: { voterFileFilterId },
      }),
      this.client.voterFileFilter.updateMany({
        where: { id: voterFileFilterId },
        data: { sampledAt: null },
      }),
    ])
  }

  private async pick(
    outreachId: number,
    organization: Organization,
    priorityId: string,
    size: number,
    criteria: Parameters<ContactsService['drawListSample']>[1],
  ): Promise<string[]> {
    const contacts = this.contacts()
    const exclude = await roundTwoExclusions(
      this.client,
      organization.slug,
      priorityId,
      outreachId,
    )
    const weights = await this.weightsFor(organization, priorityId)
    const { steered } = splitBatch(size)
    const steeredIds =
      weights && steered > 0
        ? ((await contacts.drawListSample(organization, criteria, {
            size: steered,
            seedKey: `${outreachId}:steered`,
            excludePersonIds: exclude,
            weights,
          })) ?? [])
        : []
    const rest = size - steeredIds.length
    const unsteeredIds =
      rest > 0
        ? ((await contacts.drawListSample(organization, criteria, {
            size: rest,
            seedKey: `${outreachId}:unsteered`,
            excludePersonIds: [...exclude, ...steeredIds],
          })) ?? [])
        : []
    return unionDraws(steeredIds, unsteeredIds, size)
  }

  // Null draws the whole send unsteered: the census, the answerers or the
  // district could not be read, or the fit failed. A send that goes out
  // unleaned is better than one that does not go out.
  private async weightsFor(
    organization: Organization,
    priorityId: string,
  ): Promise<SampleWeights | null> {
    const answers = await this.client.priorityAnswer.findMany({
      where: {
        organizationSlug: organization.slug,
        code: { in: [...CODED] },
        outreach: { priorityId },
      },
      select: { personId: true, code: true },
    })
    try {
      const district =
        await this.contacts().resolveEligibleDistrict(organization)
      const reads = await Promise.all(
        CODED.map((code) =>
          this.census.weightingInputs({
            ...district,
            personIds: answers
              .filter((answer) => answer.code === code)
              .map((answer) => answer.personId),
          }),
        ),
      )
      const [yes, no, mixed] = reads
      if (!yes || !no || !mixed) return null
      const coded: CodedCells = {
        yes: yes.cells,
        no: no.cells,
        mixed: mixed.cells,
      }
      const dimensions = roundTwoDimensions(
        raceNameable([...yes.cells, ...no.cells, ...mixed.cells]),
      )
      const frame = roundTwoFrame(yes.census, dimensions)
      const cells = roundTwoAnswers(coded, frame, dimensions)
      const { groups } = poststratify(fitMrp(cells, frame, {}), frame, cells)
      this.logger.info(
        {
          priorityId,
          answers: answers.length,
          leansToward: batchTargets(groups, dimensions).slice(0, 3),
        },
        'Round 2 fit to the answers so far',
      )
      return batchWeights(groups, dimensions)
    } catch (err) {
      this.logger.warn(
        { err, priorityId },
        'Round 2 could not fit the answers; drawing unsteered',
      )
      return null
    }
  }

  // Resolved lazily: importing ContactsModule here closes the module cycle
  // through Campaigns that organizationTeam.service.ts describes.
  private contacts(): ContactsService {
    return this.moduleRef.get(ContactsService, { strict: false })
  }
}

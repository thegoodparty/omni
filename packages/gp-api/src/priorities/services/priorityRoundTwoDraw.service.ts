import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { Cron } from '@nestjs/schedule'
import { subMinutes } from 'date-fns'
import {
  OutreachStatus,
  OutreachType,
  PriorityAnswerCode,
  Prisma,
  type Organization,
} from '@/generated/prisma'
import { MAX_RESOLVED_ID_SET_SIZE } from '@/contactInteraction/resolvedIdSetCap.const'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
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
import { PriorityStatusService } from './priorityStatus.service'
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

export const ROUND_TWO_DREW_NOBODY = 'round_two_drew_nobody'

// How long a drawn send may sit un-handed-off before the job hands it off.
const STRANDED_MINUTES = 30
// A list sampled this long after it was saved was drawn later: round 2.
const DRAWN_AFTER_SAVE_MINUTES = 10

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
    private readonly priorityStatus: PriorityStatusService,
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
    const stranded = await this.strandedSince(subMinutes(now, STRANDED_MINUTES))
    if (due.length === 0 && stranded.length === 0) return
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
      for (const { id, recipientCount } of stranded) {
        try {
          this.logger.warn(
            { outreachId: id },
            'Round 2 was drawn but never handed off; handing it off now',
          )
          await this.handOff(id, recipientCount)
        } catch (err) {
          this.logger.error(
            { err, outreachId: id },
            'Round 2 hand-off failed again; retried on the next run',
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

  // Safe to call again: the draw is written in one transaction that claims
  // the list by stamping `sampledAt` where it is null, so one caller's draw
  // lands and a send already drawn is left alone.
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

    const personIds = await this.pick(
      outreachId,
      organization,
      priorityId,
      size,
      { ...list, sampleSize: null, hasCellPhone: true },
    )

    // Nobody left to text, and drawing again finds the same nobody. The send
    // is canceled rather than left paid and pending, so it never reads as
    // out; staff refund it.
    if (personIds.length === 0) {
      await this.model.updateMany({
        where: { id: outreachId, ...UNDRAWN_ROUND_TWO_WHERE },
        data: {
          status: OutreachStatus.canceled,
          canceledAt: new Date(),
          canceledBy: ROUND_TWO_DREW_NOBODY,
        },
      })
      this.logger.error(
        { outreachId, requested: size },
        'Round 2 drew nobody; canceled unsent, refund it by hand',
      )
      return NOT_DRAWN
    }

    const claimed = await this.client.$transaction(async (tx) => {
      const claim = await tx.voterFileFilter.updateMany({
        where: { id: list.id, ...UNDRAWN_SAMPLE_WHERE },
        data: { sampledAt: new Date() },
      })
      if (claim.count === 0) return false
      await tx.voterFileFilterSampleMember.createMany({
        data: personIds.map((personId) => ({
          voterFileFilterId: list.id,
          personId,
        })),
        skipDuplicates: true,
      })
      return true
    })
    if (!claimed) return NOT_DRAWN
    if (personIds.length < size) {
      this.logger.warn(
        { outreachId, requested: size, delivered: personIds.length },
        'Round 2 drew fewer people than were paid for',
      )
    }

    try {
      await this.handOff(outreachId, personIds.length)
    } catch (err) {
      await this.release(list.id)
      throw err
    }
    return { drawn: true, recipientCount: personIds.length }
  }

  // The same handoff the purchase handler gives any other Serve text, and
  // like it, only a send that was enqueued puts its priority's check out.
  private async handOff(
    outreachId: number,
    recipientCount: number,
  ): Promise<void> {
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
    this.logger.info(
      { outreachId, recipientCount },
      'Round 2 drawn and handed off',
    )
    await this.priorityStatus.recordOutreachSentOrLog(outreachId, null)
  }

  // Round 2 sends drawn but still `pending` well after: the process died
  // between the draw's commit and its enqueue. Only a round 2 list is
  // sampled after it was saved (every other sample is written with its
  // members in one insert), which is what tells these apart. The window is
  // far longer than a handoff takes, and a second enqueue of a send that did
  // go out is refused by the delivery layer's claim.
  private async strandedSince(
    before: Date,
  ): Promise<Array<{ id: number; recipientCount: number }>> {
    const rows = await this.client.$queryRaw<
      Array<{ id: number; recipientCount: bigint }>
    >(Prisma.sql`
      SELECT o.id, count(m.id) AS "recipientCount"
      FROM outreach o
      JOIN voter_file_filter f ON f.id = o.voter_file_filter_id
      JOIN voter_file_filter_sample_member m ON m.voter_file_filter_id = f.id
      WHERE o.outreach_type = 'text'
      AND o."campaignId" IS NULL
      AND o.priority_id IS NOT NULL
      AND o.status = 'pending'
      AND f.sample_size IS NOT NULL
      AND f.sampled_at < ${before}
      AND f.sampled_at > f.created_at
        + make_interval(mins => ${DRAWN_AFTER_SAVE_MINUTES}::int)
      GROUP BY o.id
    `)
    return rows.map(({ id, recipientCount }) => ({
      id,
      recipientCount: Number(recipientCount),
    }))
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
      await this.optedOut(organization.slug),
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

  // The same capped read and over-cap posture as the Serve SMS create's
  // scrub: a large org still gets every opt-out the read returns.
  private async optedOut(organizationSlug: string): Promise<string[]> {
    const ids = await this.moduleRef
      .get(ContactInteractionTextService, { strict: false })
      .findOptedOutPersonIds(organizationSlug)
    if (ids.length > MAX_RESOLVED_ID_SET_SIZE) {
      this.logger.warn(
        { organizationSlug, optedOutCount: ids.length },
        'Opt-out set hit the query limit; round 2 still leaves out every ' +
          'one read, but may miss some',
      )
    }
    return ids
  }

  // Resolved lazily: importing ContactsModule here closes the module cycle
  // through Campaigns that organizationTeam.service.ts describes.
  private contacts(): ContactsService {
    return this.moduleRef.get(ContactsService, { strict: false })
  }
}

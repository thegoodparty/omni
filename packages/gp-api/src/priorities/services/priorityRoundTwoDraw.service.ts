import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { subMinutes } from 'date-fns'
import {
  OutreachStatus,
  OutreachType,
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
import { roundTwoDrawCutoff } from '@/outreach/services/outreachServeSmsCreate.service'
import { TRACT_GEOID_LENGTH } from '@/peopleDb/databricks/districtCensusSql.util'
import type { SampleWeights } from '@/peopleDb/schemas/people.schema'
import { JobsService } from '@/jobs/jobs.service'
import type { JobRun } from '@/jobs/jobs.registry'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { outreachTextSendJob } from '@/outreach/util/outreachTextSendJob.util'
import { dimensionsOf } from '../util/mrpReadStatus.util'
import { UNDRAWN_SAMPLE_WHERE, unionDraws } from '../util/roundTwo.util'
import { roundTwoExclusions } from '../util/roundTwoExclusions.util'
import {
  CENSUS_COMPOSITION_SOURCE,
  type CensusCompositionSource,
} from './censusComposition'
import { PriorityReadService } from './priorityRead.service'
import { PriorityStatusService } from './priorityStatus.service'

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
// leans most of the send toward the groups the priority's read is least
// sure about (the read the priority page shows) and draws the rest unsteered,
// freezes who was drawn onto the send's list, and hands the send off the way
// a paid Serve text is handed off at checkout. See
// docs/features/civic-panel-mrp.md.
@Injectable()
export class PriorityRoundTwoDrawService extends createPrismaBase(
  MODELS.Outreach,
) {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly jobs: JobsService,
    private readonly priorityRead: PriorityReadService,
    private readonly priorityStatus: PriorityStatusService,
    @Inject(CENSUS_COMPOSITION_SOURCE)
    private readonly census: CensusCompositionSource,
  ) {
    super()
  }

  // The priorityRoundTwoDrawDue schedule's worker. Sends one
  // priorityRoundTwoDraw job per send due a draw and one
  // priorityRoundTwoHandOff job per send drawn but never handed off.
  async fanOutDue(): Promise<void> {
    const now = new Date()
    const due = await this.model.findMany({
      where: {
        ...UNDRAWN_ROUND_TWO_WHERE,
        scheduledLocalDate: { lte: roundTwoDrawCutoff(now) },
      },
      select: { id: true },
    })
    const stranded = await this.strandedSince(subMinutes(now, STRANDED_MINUTES))
    const day = now.toISOString().slice(0, 10)
    await this.jobs.sendMany(
      'priorityRoundTwoDraw',
      due.map(({ id }) => ({ data: { outreachId: id }, key: `${id}:${day}` })),
    )
    await this.jobs.sendMany(
      'priorityRoundTwoHandOff',
      stranded.map(({ id }) => ({
        data: { outreachId: id },
        key: `${id}:${day}`,
      })),
    )
  }

  // The priorityRoundTwoDraw job's worker. A failed hand-off has put the list
  // back to undrawn before it throws, so the retry draws it again.
  async drawScheduled(job: JobRun<{ outreachId: number }>): Promise<void> {
    await this.draw(job.data.outreachId)
  }

  // The priorityRoundTwoHandOff job's worker. Re-reads the send, which a
  // run since the fan-out may have handed off already.
  async handOffStranded(job: JobRun<{ outreachId: number }>): Promise<void> {
    const { outreachId } = job.data
    const [send] = await this.strandedSince(
      subMinutes(new Date(), STRANDED_MINUTES),
      outreachId,
    )
    if (!send) return
    this.logger.warn(
      { outreachId },
      'Round 2 was drawn but never handed off; handing it off now',
    )
    await this.handOff(outreachId, send.recipientCount)
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
    await this.jobs.sendMany('outreachTextSend', [
      outreachTextSendJob({ outreachId, sendSeq: SEND_SEQ }),
    ])
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
    outreachId?: number,
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
      ${outreachId === undefined ? Prisma.empty : Prisma.sql`AND o.id = ${outreachId}`}
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

  // Leans on the read the priority page shows, brought up to date first, so
  // the follow-up goes toward the groups the page names. When it cannot be
  // brought up to date (a warehouse that did not answer, a fit that failed),
  // the last stored read still leans it. Null draws the whole send
  // unsteered: no read at all (no district, a frame too large, nothing
  // stored). A send that goes out unleaned is better than one that does not
  // go out.
  private async weightsFor(
    organization: Organization,
    priorityId: string,
  ): Promise<SampleWeights | null> {
    try {
      const read = await this.priorityRead
        .currentRead(priorityId)
        .catch(async (err: Error) => {
          const stored = await this.priorityRead.storedRead(priorityId)
          this.logger.warn(
            { err, priorityId, leansOnStoredRead: stored !== null },
            'Round 2 could not bring the read up to date',
          )
          return stored
        })
      if (!read) {
        this.logger.warn(
          { priorityId },
          'Round 2 found no read of the answers; drawing unsteered',
        )
        return null
      }
      const { groups } = read.result
      const dimensions = dimensionsOf(read.raceNameable)
      this.logger.info(
        {
          priorityId,
          leansToward: batchTargets(groups, dimensions).slice(0, 3),
        },
        'Round 2 leans on the read so far',
      )
      return await this.byTract(
        organization,
        priorityId,
        batchWeights(groups, dimensions),
      )
    } catch (err) {
      this.logger.warn(
        { err, priorityId },
        'Round 2 could not read the answers; drawing unsteered',
      )
      return null
    }
  }

  // A large district's read names areas (counties, or runs of tracts in
  // GEOID order), but the draw weighs each person by their tract: each
  // area's factor goes to the range of tracts it spans. A district read by
  // tract passes through. When the areas cannot be read, the place factors
  // are dropped and age, sex and race still lean the draw.
  private async byTract(
    organization: Organization,
    priorityId: string,
    weights: SampleWeights,
  ): Promise<SampleWeights> {
    const byArea = weights.tract ?? {}
    if (
      Object.keys(byArea).every((value) => value.length === TRACT_GEOID_LENGTH)
    ) {
      return weights
    }
    try {
      const district =
        await this.contacts().resolveEligibleDistrict(organization)
      const areas = await this.census.areaOfEachTract(district)
      if (!areas) return weights
      const spans = new Map<string, { from: string; to: string }>()
      for (const [geoid, area] of areas) {
        if (byArea[area] === undefined) continue
        const span = spans.get(area)
        spans.set(area, {
          from: span && span.from < geoid ? span.from : geoid,
          to: span && span.to > geoid ? span.to : geoid,
        })
      }
      return {
        ...weights,
        tract: {},
        tractRanges: [...spans].map(([area, span]) => ({
          ...span,
          factor: byArea[area] ?? 1,
        })),
      }
    } catch (err) {
      this.logger.warn(
        { err, priorityId },
        "Round 2 could not read the district's areas; leaning without place",
      )
      return { ...weights, tract: {} }
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

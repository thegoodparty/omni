import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { addDays, isAfter, isFuture, parseISO } from 'date-fns'
import { RobocallDraftCreateRequest } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import {
  ContactsFilterResolutionInput,
  ContactsService,
} from '@/contacts/services/contacts.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import {
  calcRobocallTotalInCents,
  ROBOCALL_NUMBER_FEE_CENTS,
} from '@/shared/util/robocallPricing.util'
import { ROBOCALL_MAX_SCHEDULE_DAYS } from '@/shared/util/robocallHold.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { RobocallComplianceResultService } from './robocallComplianceResult.service'
import {
  BoundComplianceVerdict,
  requireBoundPassingCompliance,
} from '../util/robocallComplianceGate.util'
import { OutreachRobocallSingleSendService } from './outreachRobocallSingleSend.service'
import {
  Campaign,
  Organization,
  OutreachStatus,
  OutreachType,
  RobocallSettleState,
} from '../../generated/prisma'

export interface RobocallDraftResult {
  outreachId: number
  billableCount: number
  amountInCents: number
  numberFeeInCents: number
}

interface RobocallScheduleGates {
  compliance: BoundComplianceVerdict
  billableCount: number
  amountInCents: number
}

// The robocall spine + satellite persistence and the server-side billable-count
// derivation the estimate prices off. Payment is a hold + capture-actual model:
// the draft is seeded pending_payment here, and the hold, CallHub dispatch, and
// settlement are separate later slices — none of the payment/callhub satellite
// fields are written in this slice.
@Injectable()
export class OutreachRobocallService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(
    private readonly contacts: ContactsService,
    private readonly voterFileFilterService: VoterFileFilterService,
    private readonly complianceResults: RobocallComplianceResultService,
    private readonly analytics: AnalyticsService,
    private readonly s3: S3Service,
    private readonly robocallSingleSend: OutreachRobocallSingleSendService,
  ) {
    super()
    const bucket = process.env.ROBOCALL_AUDIO_BUCKET
    if (!bucket) throw new Error('ROBOCALL_AUDIO_BUCKET is not configured')
    this.audioBucket = bucket
  }

  private readonly audioBucket: string

  // The billable count is the saved list resolved with the landline dimension
  // forced on — the same reachable-landline number the audience step showed and
  // the send-time phonebook load will dial (RobocallPhonebookService). A
  // client-supplied count is never consulted. Count-only: resultsPerPage 1 so
  // the people-db round trip returns just the total.
  async deriveBillableCount(
    organization: Organization,
    voterFileFilterId: number,
  ): Promise<number> {
    const filter =
      await this.voterFileFilterService.findByIdAndOrganizationSlug(
        voterFileFilterId,
        organization.slug,
      )
    if (!filter) {
      throw new BadRequestException(
        `Voter list ${voterFileFilterId} not found for ${organization.slug}`,
      )
    }

    const landlineFilter: ContactsFilterResolutionInput = {
      ...filter,
      hasLandline: true,
    }
    const { pagination } = await this.contacts.findContactsForFilter(
      landlineFilter,
      { resultsPerPage: 1, page: 1 },
      organization,
    )
    return pagination.totalResults
  }

  // A robocall to zero reachable landlines is not a purchasable send: a 0 count
  // yields a 0 amount, which the payment slices would treat as a fully-covered
  // purchase and settle with no charge. Reject at draft create so that path is
  // never reached.
  assertReachableCount(count: number): void {
    if (count === 0) {
      throw new BadRequestException(
        'This voter list has no reachable landline numbers to call',
      )
    }
  }

  // Persists the robocall as a pending_payment draft (spine + satellite) BEFORE
  // payment, so the later hold/settlement slices have a self-contained anchor
  // when the browser is gone (mirrors the p2p draft-first flow). Derives the
  // count/amount here for the record and the pay-step estimate. No hold, Stripe,
  // CallHub, or settlement runs here — the payment/callhub fields stay unset.
  async createDraft(
    campaign: Campaign,
    organization: Organization,
    input: RobocallDraftCreateRequest,
  ): Promise<RobocallDraftResult> {
    // A resume converts the saved draft rather than inserting: the draft row
    // holds the unique audioKey, so a second insert for the same recording
    // could never commit anyway.
    if (input.draftOutreachId) {
      return await this.convertDraft(
        campaign,
        organization,
        input,
        input.draftOutreachId,
      )
    }

    // Idempotent on a double-click / retry: a repeat POST with the same audio
    // returns the existing pending_payment draft rather than minting a second
    // billable anchor the hold/settlement slices could charge twice. Runs
    // before the schedule guard so a retry of an already-persisted draft is
    // returned even if its send time has since elapsed. The unique(audio_key)
    // constraint is the atomic backstop for the concurrent race this
    // read-before-write can't win alone.
    const existing = await this.findExistingDraft(campaign.id, input.audioKey)
    if (existing) return existing

    const { compliance, billableCount, amountInCents } =
      await this.resolveScheduleGates(organization, input)

    try {
      const outreachId = await this.client.$transaction(async (tx) => {
        const spine = await tx.outreach.create({
          data: {
            campaignId: campaign.id,
            organizationSlug: campaign.organizationSlug,
            outreachType: OutreachType.robocall,
            status: OutreachStatus.pending_payment,
            name: input.name,
            script: input.script,
            date: parseISO(input.scheduledAt),
            // The user's local calendar day (YYYY-MM-DD) from the
            // offset-annotated payload: `date` is a UTC instant, so an evening
            // US send would otherwise shift to the next day at dial time.
            scheduledLocalDate: input.scheduledAt.slice(0, 10),
            voterFileFilterId: input.voterFileFilterId,
            campaignPlanDueDate: input.campaignPlanDueDate,
          },
        })
        await tx.outreachRobocall.create({
          data: {
            outreachId: spine.id,
            audioKey: input.audioKey,
            callbackNumber: input.callbackNumber,
            billableCount,
            amountInCents,
            compliancePassedAt: compliance.checkedAt,
            complianceAudioEtag: compliance.audioEtag,
            settleState: RobocallSettleState.pending_payment,
          },
        })
        return spine.id
      })

      // Scheduled touchpoint, emitted ONLY on a fresh create (not the idempotent
      // existing-draft returns above / in the catch, which already emitted).
      // Best-effort: the draft already committed, so a Segment failure must not
      // 500 a successful create. Deterministic messageId dedups a replay.
      await this.emitScheduled(
        campaign.userId,
        outreachId,
        input.scheduledAt,
        amountInCents,
      )

      return {
        outreachId,
        billableCount,
        amountInCents,
        numberFeeInCents: ROBOCALL_NUMBER_FEE_CENTS,
      }
    } catch (err) {
      // A concurrent create won the unique(audio_key) race: return its draft
      // rather than surfacing the constraint violation. isUniqueConstraintError
      // (not instanceof) because the Prisma runtime loads from two paths in CI,
      // giving distinct constructor identities.
      if (isUniqueConstraintError(err)) {
        const raced = await this.findExistingDraft(campaign.id, input.audioKey)
        if (raced) return raced
        // Same audioKey already used by a robocall no longer awaiting payment:
        // a duplicate we can't return as a draft. Surface a clean 409
        // explicitly: the global PrismaExceptionFilter maps P2002 only via
        // `instanceof`, unreliable under CI's dual Prisma runtime (see
        // isUniqueConstraintError), so a rethrown P2002 could reach a 500.
        throw new ConflictException(
          'This recording has already been used for a robocall',
        )
      }
      throw err
    }
  }

  // The gates every schedule-a-robocall path shares, in order: the compliance
  // + ETag bind on the audio, the send-time guards, then the server-derived
  // billing. Shared with the resume path so a conversion can never be priced
  // or scheduled under weaker rules than a fresh create.
  private async resolveScheduleGates(
    organization: Organization,
    input: RobocallDraftCreateRequest,
  ): Promise<RobocallScheduleGates> {
    const compliance = await requireBoundPassingCompliance(input.audioKey, {
      s3: this.s3,
      complianceResults: this.complianceResults,
      audioBucket: this.audioBucket,
    })

    // A past send time can never dial at CallHub, so a paid draft on it would
    // be money taken for a robocall that never sends. Reject before the
    // people-db round trip.
    if (!isFuture(parseISO(input.scheduledAt))) {
      throw new BadRequestException(
        'The scheduled send time must be in the future',
      )
    }

    // Candidates can't schedule arbitrarily far out — a stale draft sitting for
    // months would drift out of sync with pricing, compliance, and the
    // audience it was built against.
    const maxScheduledAt = addDays(new Date(), ROBOCALL_MAX_SCHEDULE_DAYS)
    if (isAfter(parseISO(input.scheduledAt), maxScheduledAt)) {
      throw new BadRequestException(
        `The scheduled send time must be within ` +
          `${ROBOCALL_MAX_SCHEDULE_DAYS} days`,
      )
    }

    const billableCount = await this.deriveBillableCount(
      organization,
      input.voterFileFilterId,
    )
    this.assertReachableCount(billableCount)
    // Total = per-call cost + the flat number-rental fee. This is what the hold
    // authorizes and the capture collects, so the fee is priced in up front.
    const amountInCents = calcRobocallTotalInCents(billableCount)

    return { compliance, billableCount, amountInCents }
  }

  // Resume: the candidate saved this robocall while they could not send and is
  // Pro now, so the SAME spine + satellite become the payable draft. The
  // satellite already holds the unique audioKey, so inserting instead would
  // trip that constraint and abandon the recording the candidate approved.
  private async convertDraft(
    campaign: Campaign,
    organization: Organization,
    input: RobocallDraftCreateRequest,
    draftOutreachId: number,
  ): Promise<RobocallDraftResult> {
    const draft = await this.findFirst({
      where: {
        outreachId: draftOutreachId,
        outreach: {
          campaignId: campaign.id,
          outreachType: OutreachType.robocall,
        },
      },
      include: { outreach: { select: { status: true } } },
    })
    if (!draft) {
      throw new NotFoundException('Robocall draft not found')
    }
    if (draft.outreach.status !== OutreachStatus.draft) {
      throw new ConflictException('This robocall is no longer a draft')
    }

    const { compliance, billableCount, amountInCents } =
      await this.resolveScheduleGates(organization, input)

    try {
      await this.client.$transaction(async (tx) => {
        await tx.outreach.update({
          where: { id: draftOutreachId },
          data: {
            status: OutreachStatus.pending_payment,
            name: input.name,
            script: input.script,
            date: parseISO(input.scheduledAt),
            // The user's local calendar day, for the same reason the create
            // path stores it: `date` is a UTC instant.
            scheduledLocalDate: input.scheduledAt.slice(0, 10),
            // The audience the amount above was priced from — staging loads
            // the phonebook off this column, so a resume that changed lists
            // must not dial one list and bill another.
            voterFileFilterId: input.voterFileFilterId,
            campaignPlanDueDate: input.campaignPlanDueDate,
          },
        })
        await tx.outreachRobocall.update({
          where: { outreachId: draftOutreachId },
          data: {
            // A resume can carry a re-recorded clip, and the compliance bind
            // above was run against THIS key, so the row must point at it.
            audioKey: input.audioKey,
            callbackNumber: input.callbackNumber,
            billableCount,
            amountInCents,
            compliancePassedAt: compliance.checkedAt,
            complianceAudioEtag: compliance.audioEtag,
            settleState: RobocallSettleState.pending_payment,
          },
        })
      })
    } catch (err) {
      // The recording already belongs to another robocall (unique audio_key).
      // Surfaced explicitly for the same dual-Prisma-runtime reason as the
      // create path's catch.
      if (isUniqueConstraintError(err)) {
        throw new ConflictException(
          'This recording has already been used for a robocall',
        )
      }
      throw err
    }

    // The draft never emitted this — it had no schedule — so the conversion is
    // where the candidate's Scheduled milestone fires, as a create does.
    await this.emitScheduled(
      campaign.userId,
      draftOutreachId,
      input.scheduledAt,
      amountInCents,
    )

    return {
      outreachId: draftOutreachId,
      billableCount,
      amountInCents,
      numberFeeInCents: ROBOCALL_NUMBER_FEE_CENTS,
    }
  }

  // Emits the Scheduled milestone with a deterministic Segment messageId so a
  // replay dedups to one email. Best-effort: the draft already committed, so a
  // transient Segment failure must not fail the create.
  private async emitScheduled(
    userId: number,
    outreachId: number,
    scheduledAt: string,
    amountInCents: number,
  ): Promise<void> {
    try {
      await this.analytics.track(
        userId,
        EVENTS.Robocall.Scheduled,
        { outreachId },
        undefined,
        `${outreachId}:scheduled`,
      )
    } catch (err) {
      this.logger.error(
        { err, outreachId },
        'robocall scheduled milestone emit failed',
      )
    }

    // Single-send email leg (ENG-11035) — best-effort, never throws; see
    // OutreachRobocallSingleSendService.
    await this.robocallSingleSend.send(
      EVENTS.Robocall.Scheduled,
      userId,
      outreachId,
      {
        outreach_id: String(outreachId),
        scheduled_at: scheduledAt,
        amount_dollars: String(amountInCents / 100),
      },
    )
  }

  // Scoped to the two statuses whose row still holds this recording before it
  // is paid for: once a later slice advances the status, a repeat POST with the
  // same audioKey misses this read and trips the unique index (409, still
  // money-safe — the INSERT fails atomically). Per-recording keys make that
  // path unlikely.
  private async findExistingDraft(
    campaignId: number,
    audioKey: string,
  ): Promise<RobocallDraftResult | null> {
    const existing = await this.findFirst({
      where: {
        audioKey,
        outreach: {
          campaignId,
          status: {
            in: [OutreachStatus.draft, OutreachStatus.pending_payment],
          },
          outreachType: OutreachType.robocall,
        },
      },
      include: { outreach: { select: { status: true } } },
    })
    if (!existing) return null
    // A saved draft already owns this recording. Scheduling it must go through
    // the resume path (draftOutreachId) — converting it off a bare create would
    // schedule and bill a row the caller never named.
    if (existing.outreach.status === OutreachStatus.draft) {
      throw new ConflictException({
        message: 'This recording already belongs to a saved draft',
        existingId: existing.outreachId,
      })
    }
    // Null billing belongs to the `draft` state alone, handled above.
    if (existing.billableCount === null) {
      throw new InternalServerErrorException(
        'robocall billing missing on a non-draft row',
      )
    }
    return {
      outreachId: existing.outreachId,
      billableCount: existing.billableCount,
      // Recompute rather than trust the stored column: a draft created
      // before the number fee shipped has a stale, fee-less amountInCents,
      // and returning it would understate the total by the fee.
      amountInCents: calcRobocallTotalInCents(existing.billableCount),
      numberFeeInCents: ROBOCALL_NUMBER_FEE_CENTS,
    }
  }
}

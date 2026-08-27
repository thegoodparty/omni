import { BadRequestException, Injectable } from '@nestjs/common'
import { isFuture, parseISO } from 'date-fns'
import { RobocallDraftCreateRequest } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import {
  ContactsFilterResolutionInput,
  ContactsService,
} from '@/contacts/services/contacts.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { calcRobocallAmountInCents } from '@/shared/util/robocallPricing.util'
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
  ) {
    super()
  }

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
  private assertReachableCount(count: number): void {
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
    // Reject a past send time before the people-db round trip: a paid draft
    // whose schedule is in the past can never dial at CallHub, so the caller
    // would be charged for a robocall that never sends.
    if (!isFuture(parseISO(input.scheduledAt))) {
      throw new BadRequestException(
        'The scheduled send time must be in the future',
      )
    }

    // Idempotent on a double-click / retry / network retry: a repeat POST with
    // the same audio for this campaign returns the existing pending_payment
    // draft rather than minting a second billable anchor the hold/settlement
    // slices could charge twice. audioKey is a fresh per-recording key, so it
    // is the natural dedup key for one intended send.
    const existing = await this.findFirst({
      where: {
        audioKey: input.audioKey,
        outreach: {
          campaignId: campaign.id,
          status: OutreachStatus.pending_payment,
          outreachType: OutreachType.robocall,
        },
      },
    })
    if (existing) {
      return {
        outreachId: existing.outreachId,
        billableCount: existing.billableCount,
        amountInCents: existing.amountInCents,
      }
    }

    const billableCount = await this.deriveBillableCount(
      organization,
      input.voterFileFilterId,
    )
    this.assertReachableCount(billableCount)
    const amountInCents = calcRobocallAmountInCents(billableCount)

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
          voterFileFilterId: input.voterFileFilterId,
        },
      })
      await tx.outreachRobocall.create({
        data: {
          outreachId: spine.id,
          audioKey: input.audioKey,
          callbackNumber: input.callbackNumber,
          billableCount,
          amountInCents,
          settleState: RobocallSettleState.pending_payment,
        },
      })
      return spine.id
    })

    return { outreachId, billableCount, amountInCents }
  }
}

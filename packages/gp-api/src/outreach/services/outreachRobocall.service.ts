import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { RobocallDraftCreateRequest } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import {
  ContactsFilterResolutionInput,
  ContactsService,
} from '@/contacts/services/contacts.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { calcRobocallAmountInCents } from '@/shared/util/robocallPricing.util'
import {
  Campaign,
  Organization,
  OutreachStatus,
  OutreachType,
} from '../../generated/prisma'

export interface RobocallDraftResult {
  outreachId: number
  billableCount: number
  amountInCents: number
}

// The robocall spine + satellite persistence, the server-side billable-count
// derivation both the draft and checkout price off, and the payment-webhook
// finalize. Prepay-on-estimate for now (charge the derived estimate up front,
// like TEXT); the clean seam to a save-card/charge-actual model later is
// deriveBillableCount + calcRobocallAmountInCents — swap the amount source
// there, the persistence and finalize are model-agnostic.
@Injectable()
export class OutreachRobocallService extends createPrismaBase(
  MODELS.OutreachRobocall,
) {
  constructor(
    private readonly contacts: ContactsService,
    private readonly organizations: OrganizationsService,
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

  // Persists the robocall as a pending_payment draft (spine + satellite) BEFORE
  // checkout, so a payment-webhook finalize is self-contained when the browser
  // is gone (mirrors the p2p draft-first flow). Derives the count/amount here
  // for the record and the pay step; checkout re-derives the amount live.
  async createDraft(
    campaign: Campaign,
    organization: Organization,
    input: RobocallDraftCreateRequest,
  ): Promise<RobocallDraftResult> {
    const billableCount = await this.deriveBillableCount(
      organization,
      input.voterFileFilterId,
    )
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
          date: new Date(input.scheduledAt),
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
        },
      })
      return spine.id
    })

    return { outreachId, billableCount, amountInCents }
  }

  // Loads the pending_payment draft scoped to the paying campaign and confirms
  // it is a robocall still awaiting payment. campaignId is the server-validated
  // scope; outreachId rides in client-influenced checkout metadata and must not
  // reach another campaign's draft. A paid/absent draft is a re-checkout of an
  // already-settled purchase — reject rather than charging twice.
  private async loadBillableDraft(outreachId: number, campaignId: number) {
    const draft = await this.client.outreach.findFirst({
      where: {
        id: outreachId,
        campaignId,
        outreachType: OutreachType.robocall,
      },
      select: { status: true, organizationSlug: true, voterFileFilterId: true },
    })
    if (!draft) {
      throw new BadRequestException(
        `Robocall draft ${outreachId} not found for campaign ${campaignId}`,
      )
    }
    if (draft.status !== OutreachStatus.pending_payment) {
      throw new ConflictException(
        'This robocall has already been purchased. Please refresh the page.',
      )
    }
    if (!draft.organizationSlug || !draft.voterFileFilterId) {
      throw new BadRequestException(
        'Robocall draft is missing the audience needed to bill it',
      )
    }
    return {
      organizationSlug: draft.organizationSlug,
      voterFileFilterId: draft.voterFileFilterId,
    }
  }

  // The checkout amount: re-derives the count live from the draft's audience
  // rather than trusting the snapshot persisted at draft time (the audience can
  // change between draft and pay). Mirrors the TEXT handler's live re-derive.
  async deriveDraftAmount(
    outreachId: number,
    campaignId: number,
  ): Promise<number> {
    const { organizationSlug, voterFileFilterId } =
      await this.loadBillableDraft(outreachId, campaignId)
    const organization = await this.organizations.findFirst({
      where: { slug: organizationSlug },
    })
    if (!organization) {
      throw new BadRequestException(
        `Organization ${organizationSlug} not found`,
      )
    }
    return calcRobocallAmountInCents(
      await this.deriveBillableCount(organization, voterFileFilterId),
    )
  }

  // Same guard as deriveDraftAmount, used by validatePurchase to reject a
  // re-checkout before any Stripe session is minted.
  async assertPurchasable(
    outreachId: number,
    campaignId: number,
  ): Promise<void> {
    await this.loadBillableDraft(outreachId, campaignId)
  }

  // Payment-webhook finalize: atomically claim pending_payment -> paid, scoped
  // to the paying campaign — the DB lock that makes the client-vs-webhook
  // completion race harmless. No dialing / CallHub campaign here; the send
  // chain is separate slices. Idempotent: a lost claim that is already paid is
  // a no-op; anything else throws so the payment layer never stamps its
  // idempotency marker and Stripe retries.
  async finalizeRobocallPurchase(
    outreachId: number,
    campaignId: number,
  ): Promise<void> {
    const claimed = await this.client.outreach.updateMany({
      where: {
        id: outreachId,
        campaignId,
        outreachType: OutreachType.robocall,
        status: OutreachStatus.pending_payment,
      },
      data: { status: OutreachStatus.paid },
    })
    if (claimed.count > 0) return

    const row = await this.client.outreach.findFirst({
      where: {
        id: outreachId,
        campaignId,
        outreachType: OutreachType.robocall,
      },
      select: { status: true },
    })
    if (row?.status === OutreachStatus.paid) return

    throw new NotFoundException(
      `Robocall outreach ${outreachId} was not finalized: missing, not owned ` +
        `by campaign ${campaignId}, or not awaiting payment`,
    )
  }
}

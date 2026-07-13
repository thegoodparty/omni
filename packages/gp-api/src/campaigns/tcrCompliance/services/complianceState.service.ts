import { Injectable } from '@nestjs/common'
import {
  Campaign,
  Domain,
  DomainStatus,
  TcrCompliance,
  TcrComplianceStatus,
  Website,
  WebsiteStatus,
} from '../../../generated/prisma'
import {
  ComplianceStage,
  PeerlyCvVerificationStatus,
  PeerlyCvVerificationStatusSchema,
  type ComplianceStateOutput,
} from '@goodparty_org/contracts'
import { formatISO, isBefore, parseISO } from 'date-fns'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { PeerlyIdentityService } from '../../../vendors/peerly/services/peerlyIdentity.service'
import { maskPinDeliveryDestination } from '../../../vendors/peerly/utils/peerlyPinDelivery.util'

const DOMAIN_REGISTERED_STATUSES: DomainStatus[] = [
  DomainStatus.submitted,
  DomainStatus.registered,
  DomainStatus.active,
]

// Purchase-time registrantVerifiedAt stamping only became universal on
// 2026-06-01 (prod data: zero registered-status domains created after
// 2026-05-31 lack the stamp; ~300 created before it have it NULL forever —
// the interim email-verification flow that would have stamped them was
// removed 2026-05-29). The registrant contact has always been the constant,
// already-ICANN-verified GoodParty identity, so treat pre-cutoff rows as
// verified; requiring the stamp stranded legacy-domain Pro upgrades at
// pending_website_live until the agent's resume cap (campaign 304314).
export const REGISTRANT_STAMPING_UNIVERSAL_FROM = parseISO(
  '2026-06-01T00:00:00Z',
)

@Injectable()
export class ComplianceStateService extends createPrismaBase(MODELS.Campaign) {
  constructor(private readonly peerlyIdentityService: PeerlyIdentityService) {
    super()
  }

  private loadComplianceRelations(campaignId: number) {
    return this.model.findUniqueOrThrow({
      where: { id: campaignId },
      include: {
        tcrCompliance: true,
        website: { include: { domain: true } },
      },
    })
  }

  // Stage only, no live Peerly read. Callers that just need the pipeline stage
  // (e.g. the submit-to-peerly write path) must use this rather than
  // `findStateForCampaign`, which fires a Peerly `retrieve_cv` call.
  async getStageForCampaign(campaignId: number): Promise<ComplianceStage> {
    const campaign = await this.loadComplianceRelations(campaignId)
    const website = campaign.website ?? null
    return deriveComplianceStage(
      campaign,
      website,
      website?.domain ?? null,
      campaign.tcrCompliance ?? null,
    )
  }

  async findStateForCampaign(
    campaignId: number,
  ): Promise<ComplianceStateOutput> {
    const campaign = await this.loadComplianceRelations(campaignId)

    const website = campaign.website ?? null
    const domain = website?.domain ?? null
    const tcrCompliance = campaign.tcrCompliance ?? null

    const stage = deriveComplianceStage(
      campaign,
      website,
      domain,
      tcrCompliance,
    )

    const cvState = await this.resolvePeerlyCvState(
      stage,
      campaign,
      tcrCompliance,
    )

    return {
      stage,
      domain: domain
        ? {
            name: domain.name,
            status: domain.status,
            registrantVerifiedAt: domain.registrantVerifiedAt
              ? formatISO(domain.registrantVerifiedAt)
              : null,
          }
        : null,
      websiteId: website?.id ?? null,
      peerlyVerificationId: tcrCompliance?.peerlyCvVerificationId ?? null,
      ...cvState,
    }
  }

  // The live CV status + PIN delivery only matter at `awaiting_pin`, where the
  // FE gates the PIN-entry screen on the status (APPROVED+ means Peerly has
  // issued a PIN) and shows the candidate where the PIN was sent. Resolving
  // them only in that stage keeps the extra Peerly read off the other stages
  // the compliance_setup agent polls on every run. One retrieve_cv call yields
  // both.
  private async resolvePeerlyCvState(
    stage: ComplianceStage,
    campaign: Campaign,
    tcrCompliance: Pick<TcrCompliance, 'peerlyIdentityId'> | null,
  ): Promise<Pick<ComplianceStateOutput, 'peerlyCvStatus' | 'pinDelivery'>> {
    if (stage !== ComplianceStage.awaiting_pin) {
      return { peerlyCvStatus: null, pinDelivery: null }
    }

    // Non-prod short-circuits Peerly submission (see websites.service.ts
    // verifyLive), so there is no real CV to query; report APPROVED so testers
    // still reach the PIN screen (mirrors retrieveCampaignVerifyToken's bypass).
    // There is no real delivery, so pinDelivery stays null.
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') {
      return {
        peerlyCvStatus: PeerlyCvVerificationStatus.APPROVED,
        pinDelivery: null,
      }
    }

    const peerlyIdentityId = tcrCompliance?.peerlyIdentityId
    if (!peerlyIdentityId) {
      return { peerlyCvStatus: null, pinDelivery: null }
    }

    let details: Awaited<
      ReturnType<
        typeof this.peerlyIdentityService.retrieveCampaignVerifyDetails
      >
    >
    try {
      details = await this.peerlyIdentityService.retrieveCampaignVerifyDetails(
        peerlyIdentityId,
        campaign,
      )
    } catch (e) {
      // A non-404 Peerly error (5xx / auth / timeout) makes retrieve throw a
      // BadGatewayException; without this guard it would 502 the whole
      // compliance-state read (agent + FE). Degrade to the in-progress state.
      this.logger.error(
        { e },
        `Failed to retrieve Peerly CV details for identity ` +
          `${peerlyIdentityId}; degrading to null`,
      )
      return { peerlyCvStatus: null, pinDelivery: null }
    }
    // Peerly's `verification_status` is not yet a hardened enum on their side;
    // parse defensively so an unrecognized value degrades to the in-progress
    // state instead of 500ing the compliance-state read (agent + FE).
    const parsed = PeerlyCvVerificationStatusSchema.safeParse(details.status)
    return {
      peerlyCvStatus: parsed.success ? parsed.data : null,
      // Mask the raw destination server-side so the candidate's filing
      // email/phone/address never crosses the wire (only the display string).
      pinDelivery: details.pinDelivery
        ? {
            method: details.pinDelivery.method,
            displayString: maskPinDeliveryDestination(details.pinDelivery),
          }
        : null,
    }
  }
}

export const deriveComplianceStage = (
  campaign: Pick<Campaign, 'formattedAddress'>,
  website: Pick<Website, 'status'> | null,
  domain: Pick<Domain, 'status' | 'registrantVerifiedAt' | 'createdAt'> | null,
  tcrCompliance: Pick<TcrCompliance, 'status'> | null,
): ComplianceStage => {
  if (!tcrCompliance) {
    return campaign.formattedAddress
      ? ComplianceStage.needs_filing
      : ComplianceStage.needs_profile
  }

  if (
    tcrCompliance.status === TcrComplianceStatus.rejected ||
    tcrCompliance.status === TcrComplianceStatus.error
  ) {
    return ComplianceStage.tcr_rejected
  }

  // A live website is a hard precondition for submitting to Peerly, so it
  // gates every submission-or-later stage. A submission-era TCR status
  // (submitted/pending/approved) does not prove the site is currently serving:
  // a previously-published site can be unpublished, and `approved` can predate
  // a domain that never verified. Deriving from the live site here means a
  // stale `approved` reports `pending_website_live`, so the setup agent
  // republishes and re-verifies instead of skipping those steps.
  const domainRegistered = Boolean(
    domain && DOMAIN_REGISTERED_STATUSES.includes(domain.status),
  )
  if (!domainRegistered) {
    return ComplianceStage.pending_domain_purchase
  }

  const registrantVerified = domain
    ? Boolean(domain.registrantVerifiedAt) ||
      isBefore(domain.createdAt, REGISTRANT_STAMPING_UNIVERSAL_FROM)
    : false
  const websiteLive =
    website?.status === WebsiteStatus.published && registrantVerified
  if (!websiteLive) {
    return ComplianceStage.pending_website_live
  }

  if (tcrCompliance.status === TcrComplianceStatus.approved) {
    return ComplianceStage.tcr_approved
  }
  if (tcrCompliance.status === TcrComplianceStatus.pending) {
    return ComplianceStage.tcr_in_review
  }

  return ComplianceStage.awaiting_pin
}

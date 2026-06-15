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
  type ComplianceStateOutput,
} from '@goodparty_org/contracts'
import { formatISO } from 'date-fns'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'

const DOMAIN_REGISTERED_STATUSES: DomainStatus[] = [
  DomainStatus.submitted,
  DomainStatus.registered,
  DomainStatus.active,
]

@Injectable()
export class ComplianceStateService extends createPrismaBase(MODELS.Campaign) {
  async findStateForCampaign(
    campaignId: number,
  ): Promise<ComplianceStateOutput> {
    const campaign = await this.model.findUniqueOrThrow({
      where: { id: campaignId },
      include: {
        tcrCompliance: true,
        website: { include: { domain: true } },
      },
    })

    const website = campaign.website ?? null
    const domain = website?.domain ?? null
    const tcrCompliance = campaign.tcrCompliance ?? null

    return {
      stage: deriveComplianceStage(campaign, website, domain, tcrCompliance),
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
    }
  }
}

export const deriveComplianceStage = (
  campaign: Pick<Campaign, 'formattedAddress'>,
  website: Pick<Website, 'status'> | null,
  domain: Pick<Domain, 'status' | 'registrantVerifiedAt'> | null,
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

  const websiteLive =
    website?.status === WebsiteStatus.published &&
    Boolean(domain?.registrantVerifiedAt)
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

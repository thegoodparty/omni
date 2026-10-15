import { Injectable } from '@nestjs/common'
import { AdminUpdateCampaignSchema } from './schemas/adminUpdateCampaign.schema'
import { Prisma } from '../../generated/prisma'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import { CrmCampaignsService } from '../../campaigns/services/crmCampaigns.service'
import { VoterFileDownloadAccessService } from '../../shared/services/voterFileDownloadAccess.service'
import { EVENTS } from 'src/vendors/segment/segment.types'
import { AnalyticsService } from 'src/analytics/analytics.service'
import { PinoLogger } from 'nestjs-pino'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { StripeService } from 'src/vendors/stripe/services/stripe.service'

@Injectable()
export class AdminCampaignsService {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly voterFileDownloadAccess: VoterFileDownloadAccessService,
    private readonly crm: CrmCampaignsService,
    private readonly analytics: AnalyticsService,
    private readonly organizations: OrganizationsService,
    private readonly stripe: StripeService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminCampaignsService.name)
  }

  async update(id: number, body: AdminUpdateCampaignSchema) {
    const { isVerified, isPro, didWin, tier } = body
    const attributes: Prisma.CampaignUpdateInput = {}

    if (typeof isVerified !== 'undefined') {
      attributes.isVerified = isVerified
      attributes.dateVerified = isVerified === null ? null : new Date()
    }
    if (typeof isPro !== 'undefined') {
      attributes.isPro = isPro
    }
    if (typeof didWin !== 'undefined') {
      attributes.didWin = didWin
    }
    if (typeof tier !== 'undefined') {
      attributes.tier = tier
    }

    // Admin de-Pro must cancel the live Stripe subscription too (ENG-10660).
    // Without this, `isPro` flips to false while Stripe keeps billing and
    // details.subscriptionId stays populated — the exact "charged in Stripe,
    // invisible in product" state ENG-10657 documented. Cancel Stripe FIRST
    // so a Stripe failure surfaces a 502 before the DB write and leaves both
    // sides intact; the resulting customer.subscription.deleted webhook then
    // runs persistCampaignProCancellation to clear subscriptionId.
    if (isPro === false) {
      const existing = await this.campaigns.findUniqueOrThrow({
        where: { id },
      })
      const subscriptionId = existing.details?.subscriptionId
      if (subscriptionId) {
        await this.stripe.cancelSubscription(subscriptionId)
      }
    }

    const updatedCampaign = await this.campaigns.update({
      where: { id },
      data: attributes,
    })
    if (isPro === true) {
      try {
        await this.analytics.track(
          updatedCampaign?.userId,
          EVENTS.Account.ProSubscriptionConfirmed,
          {
            price: 0,
            paymentMethod: 'admin',
          },
        )
      } catch (error) {
        this.logger.error(
          { error },
          `[ADMIN] Failed to track admin pro subscription analytics - User: ${updatedCampaign?.userId}, Campaign: ${id}`,
        )
        // Don't throw - we don't want to fail the admin operation for analytics issues
      }
    }
    await this.crm.trackCampaign(updatedCampaign.id)

    return updatedCampaign
  }

  async proNoVoterFile() {
    const campaigns = await this.campaigns.findMany({
      where: {
        NOT: {
          userId: undefined,
        },
        isPro: true,
      },
    })

    const districtResults = await Promise.allSettled(
      campaigns.map((c) =>
        c.organizationSlug
          ? this.organizations.getDistrictAndBallotLevelForOrgSlug(
              c.organizationSlug,
            )
          : null,
      ),
    )

    return campaigns.filter((campaign, i) => {
      const result = districtResults[i]
      if (!result) {
        // Settled results map 1:1 with campaigns, so this is unreachable; fail
        // closed (treat as blocked) to match the rejected/no-slug handling below.
        return true
      }
      if (result.status === 'rejected') {
        // Fail closed: if we can't resolve the authoritative level, don't let
        // canDownload fall back to the user-editable details.ballotLevel — that
        // would drop a spoofed-local FEDERAL campaign off this audit list.
        const err: unknown = result.reason
        this.logger.warn(
          { campaignId: campaign.id, err },
          'Failed to resolve district/ballotLevel for campaign — treating as blocked',
        )
        return true
      }
      const resolved = result.value
      if (resolved === null) {
        // No organizationSlug — no authoritative ballot level available, so we
        // can't confirm eligibility without trusting details.ballotLevel. Fail
        // closed, same as the rejected case above.
        return true
      }
      return !this.voterFileDownloadAccess.canDownload(
        campaign,
        resolved.district ?? null,
        resolved.ballotLevel ?? null,
      )
    })
  }
}

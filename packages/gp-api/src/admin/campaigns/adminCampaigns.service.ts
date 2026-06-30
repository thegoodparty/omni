import { Injectable } from '@nestjs/common'
import { AdminCreateCampaignSchema } from './schemas/adminCreateCampaign.schema'
import { AdminUpdateCampaignSchema } from './schemas/adminUpdateCampaign.schema'
import { Prisma } from '../../generated/prisma'
import { EmailService } from 'src/email/email.service'
import { UsersService } from 'src/users/services/users.service'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import { CampaignCreatedBy, OnboardingStep } from '@goodparty_org/contracts'
import { CrmCampaignsService } from '../../campaigns/services/crmCampaigns.service'
import { VoterFileDownloadAccessService } from '../../shared/services/voterFileDownloadAccess.service'
import { AuthenticationService } from 'src/authentication/authentication.service'
import { EVENTS } from 'src/vendors/segment/segment.types'
import { AnalyticsService } from 'src/analytics/analytics.service'
import { PinoLogger } from 'nestjs-pino'
import { OrganizationsService } from '@/organizations/services/organizations.service'

@Injectable()
export class AdminCampaignsService {
  constructor(
    private readonly email: EmailService,
    private readonly users: UsersService,
    private readonly campaigns: CampaignsService,
    private readonly voterFileDownloadAccess: VoterFileDownloadAccessService,
    private readonly crm: CrmCampaignsService,
    private readonly auth: AuthenticationService,
    private readonly analytics: AnalyticsService,
    private readonly organizations: OrganizationsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminCampaignsService.name)
  }

  async create(body: AdminCreateCampaignSchema) {
    const {
      firstName,
      lastName,
      email,
      zip,
      phone,
      party,
      otherParty,
      adminUserEmail,
    } = body

    // create new user
    const user = await this.users.createUser({
      firstName,
      lastName,
      email,
      zip,
      phone,
    })

    const resetToken = this.auth.generatePasswordResetToken()
    const updatedUser = await this.users.setResetToken(user.id, resetToken)
    this.email.sendSetPasswordEmail(updatedUser)
    this.analytics.track(user.id, EVENTS.Onboarding.UserCreated)

    // find slug
    const slug = await this.campaigns.findSlug(user)
    const data = {
      slug,
      currentStep: OnboardingStep.complete,
      party,
      otherParty,
      createdBy: CampaignCreatedBy.ADMIN,
      adminUserEmail,
    }

    // create new campaign
    const newCampaign = await this.campaigns.client.$transaction(async (tx) => {
      const [{ nextval: id }] = await tx.$queryRaw<[{ nextval: bigint }]>`
        SELECT nextval('campaign_id_seq')`

      const campaignId = Number(id)
      const orgSlug = OrganizationsService.campaignOrgSlug(campaignId)
      await tx.organization.create({
        data: {
          slug: orgSlug,
          ownerId: user.id,
        },
      })
      const campaign = await tx.campaign.create({
        data: {
          id: campaignId,
          slug,
          organizationSlug: orgSlug,
          data,
          isActive: true,
          userId: user.id,
          details: {
            zip: user.zip,
            knowRun: 'yes',
            pledged: true,
          },
        },
      })

      return campaign
    })

    await this.crm.trackCampaign(newCampaign.id)

    return newCampaign
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

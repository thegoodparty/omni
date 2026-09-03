import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Campaign, OrganizationRole } from '../../generated/prisma'
import { PinoLogger } from 'nestjs-pino'

import { OrganizationMembershipService } from '@/organizations/services/organizationMembership.service'
import {
  REQUIRE_CAMPAIGN_META_KEY,
  RequireCampaignMetadata,
} from '../decorators/UseCampaign.decorator'
import { CampaignsService } from '../services/campaigns.service'

/**
 * Guard that resolves a Campaign and attaches it to the request.
 *
 * Requires the `X-Organization-Slug` header. Resolves a role for the org
 * (owner fallback, else a membership row), then fetches the associated
 * campaign.
 */
@Injectable()
export class UseCampaignGuard implements CanActivate {
  constructor(
    private campaignsService: CampaignsService,
    private organizationMembership: OrganizationMembershipService,
    private reflector: Reflector,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(UseCampaignGuard.name)
  }

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>
      campaign?: Campaign
      organizationRole?: OrganizationRole
      user: { id: number }
    }>()

    const { continueIfNotFound, include: campaignInclude } =
      this.reflector.getAllAndOverride<RequireCampaignMetadata>(
        REQUIRE_CAMPAIGN_META_KEY,
        [context.getHandler(), context.getClass()],
      )

    const userId = request.user.id
    const include = campaignInclude ?? {}
    let campaign: Campaign | null = null
    let role: OrganizationRole | undefined

    const slug = request.headers['x-organization-slug']
    if (typeof slug === 'string') {
      const resolved = await this.organizationMembership.resolveRole(
        slug,
        userId,
      )
      // Fail closed: volunteer memberships don't exist yet, but this guard
      // backs write routes across most feature modules, so a future
      // volunteer row must not get in here by default (Phase 1.5 grants
      // specific surfaces deliberately).
      if (resolved && resolved.role !== OrganizationRole.volunteer) {
        campaign = await this.campaignsService.findFirst({
          where: { organizationSlug: slug },
          include,
        })
        role = resolved.role
      }
    }

    if (campaign) {
      request.campaign = campaign
      request.organizationRole = role
      return true
    } else if (continueIfNotFound === true) {
      return true
    }

    this.logger.info('User has no campaign')
    throw new NotFoundException()
  }
}

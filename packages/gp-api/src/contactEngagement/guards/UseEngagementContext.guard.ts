import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  Campaign,
  ElectedOffice,
  OrganizationRole,
} from '../../generated/prisma'
import { PinoLogger } from 'nestjs-pino'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { ElectedOfficeService } from '@/electedOffice/services/electedOffice.service'
import { OrganizationMembershipService } from '@/organizations/services/organizationMembership.service'

// Resolves the engagement context from `X-Organization-Slug` and attaches it
// to the request: an ElectedOffice for `eo-` orgs (the existing poll path,
// deliberately owner-only in Phase 1) or a Campaign for Win orgs (the
// outreach path, which admits campaignAdmin members but not volunteers). The
// `eo-` prefix is the same Win/Serve discriminator the contacts path uses.
@Injectable()
export class UseEngagementContextGuard implements CanActivate {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly electedOffice: ElectedOfficeService,
    private readonly organizationMembership: OrganizationMembershipService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(UseEngagementContextGuard.name)
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>
      user: { id: number }
      electedOffice?: ElectedOffice
      campaign?: Campaign
      organizationRole?: OrganizationRole
    }>()

    const userId = request.user.id
    const slug = request.headers['x-organization-slug']

    if (typeof slug !== 'string') {
      throw new NotFoundException()
    }

    const resolved = await this.organizationMembership.resolveRole(slug, userId)
    // Fail closed regardless of surface: a volunteer gets neither the Serve
    // poll path nor the Win CRM engagement context. This is permanent
    // posture for the CRM, not a Phase 1.5 stopgap — unlike the scoping
    // guards (UseOrganizationGuard / UseCampaignGuard), which now resolve
    // and attach any member and leave role enforcement to
    // OrganizationRoleGuard, this guard keeps its own volunteer denial.
    if (!resolved || resolved.role === OrganizationRole.volunteer) {
      throw new NotFoundException()
    }

    if (slug.startsWith('eo-')) {
      // Serve stays owner-only in Phase 1: this lookup is still keyed on
      // userId, and ElectedOffice.userId is the org owner's id, so a member
      // resolved above still 404s here.
      const electedOffice = await this.electedOffice.findFirst({
        where: { organizationSlug: slug, userId },
      })
      if (!electedOffice) {
        throw new NotFoundException()
      }
      request.electedOffice = electedOffice
      request.organizationRole = resolved.role
      return true
    }

    const campaign = await this.campaigns.findFirst({
      where: { organizationSlug: slug },
    })
    if (!campaign) {
      throw new NotFoundException()
    }

    request.campaign = campaign
    request.organizationRole = resolved.role
    return true
  }
}

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import { OrganizationRole } from 'src/generated/prisma'
import { OrganizationMembershipService } from 'src/organizations/services/organizationMembership.service'
import { OrganizationsService } from 'src/organizations/services/organizations.service'
import { VoterFileDownloadAccessService } from '../../../shared/services/voterFileDownloadAccess.service'

@Injectable()
export class CanDownloadVoterFileGuard implements CanActivate {
  constructor(
    private campaignsService: CampaignsService,
    private voterFileDownloadAccess: VoterFileDownloadAccessService,
    private organizationsService: OrganizationsService,
    private organizationMembership: OrganizationMembershipService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { user, headers } = context.switchToHttp().getRequest<{
      user: { id: number }
      headers: Record<string, string | undefined>
    }>()

    // Scope download access to the org the client is acting in (mirrors
    // UseCampaignGuard) rather than the user's arbitrary first campaign, so a
    // multi-org user can't authorize against an org they aren't acting in.
    const slug = headers['x-organization-slug']
    if (typeof slug !== 'string') return false

    const resolved = await this.organizationMembership.resolveRole(
      slug,
      user.id,
    )
    if (!resolved) return false

    // Fail closed regardless of plan: a volunteer never gets the file, even
    // on a download-eligible campaign.
    if (resolved.role === OrganizationRole.volunteer) return false

    const campaign = await this.campaignsService.findFirst({
      where: { organizationSlug: slug },
    })
    if (!campaign) return false

    const { district, ballotLevel } = campaign.organizationSlug
      ? await this.organizationsService.getDistrictAndBallotLevelForOrgSlug(
          campaign.organizationSlug,
        )
      : { district: null, ballotLevel: null }

    const result = this.voterFileDownloadAccess.canDownload(
      campaign,
      district,
      ballotLevel,
    )
    return Boolean(result)
  }
}

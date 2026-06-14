import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { CampaignsService } from 'src/campaigns/services/campaigns.service'
import { OrganizationsService } from 'src/organizations/services/organizations.service'
import { VoterFileDownloadAccessService } from '../../../shared/services/voterFileDownloadAccess.service'

@Injectable()
export class CanDownloadVoterFileGuard implements CanActivate {
  constructor(
    private campaignsService: CampaignsService,
    private voterFileDownloadAccess: VoterFileDownloadAccessService,
    private organizationsService: OrganizationsService,
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

    const [org, campaign] = await Promise.all([
      this.campaignsService.client.organization.findFirst({
        where: { slug, ownerId: user.id },
      }),
      this.campaignsService.findFirst({
        where: { organizationSlug: slug, userId: user.id },
      }),
    ])
    if (!org || !campaign) return false

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

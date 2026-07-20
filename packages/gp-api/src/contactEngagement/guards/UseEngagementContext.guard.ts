import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Campaign, ElectedOffice } from '../../generated/prisma'
import { PinoLogger } from 'nestjs-pino'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { ElectedOfficeService } from '@/electedOffice/services/electedOffice.service'

// Resolves the engagement context from `X-Organization-Slug` + ownership and
// attaches it to the request: an ElectedOffice for `eo-` orgs (the existing
// poll path) or a Campaign for Win orgs (the outreach path). The
// `eo-` prefix is the same Win/Serve discriminator the contacts path uses.
@Injectable()
export class UseEngagementContextGuard implements CanActivate {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly electedOffice: ElectedOfficeService,
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
    }>()

    const userId = request.user.id
    const slug = request.headers['x-organization-slug']

    if (typeof slug !== 'string') {
      throw new NotFoundException()
    }

    const org = await this.campaigns.client.organization.findFirst({
      where: { slug, ownerId: userId },
    })
    if (!org) {
      throw new NotFoundException()
    }

    if (slug.startsWith('eo-')) {
      const electedOffice = await this.electedOffice.findFirst({
        where: { organizationSlug: slug, userId },
      })
      if (!electedOffice) {
        throw new NotFoundException()
      }
      request.electedOffice = electedOffice
      return true
    }

    const campaign = await this.campaigns.findFirst({
      where: { organizationSlug: slug, userId },
    })
    if (!campaign) {
      throw new NotFoundException()
    }

    request.campaign = campaign
    return true
  }
}

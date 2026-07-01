import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ChatScope } from '../../../generated/prisma'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { ElectedOfficeService } from '@/electedOffice/services/electedOffice.service'

// Campaign-backed scopes resolve their org from the candidate's campaign; every
// other scope resolves it from the user's elected office. Both paths verify the
// org is owned by the authed user, mirroring UseCampaign / UseElectedOffice, so
// the elected-office scopes (Chief of Staff, briefing annotation) behave exactly
// as they did under @UseElectedOffice.
const CAMPAIGN_SCOPES: ReadonlySet<ChatScope> = new Set([
  ChatScope.campaign_assistant,
])

interface ChatOrgRequest {
  headers: Record<string, string | undefined>
  user: { id: number }
  body?: { scope?: ChatScope }
  query?: { scope?: ChatScope }
  chatOrganizationSlug?: string
}

@Injectable()
export class ChatOrgGuard implements CanActivate {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly electedOffices: ElectedOfficeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ChatOrgRequest>()
    const userId = request.user.id
    const slug = request.headers['x-organization-slug']
    const scope = request.body?.scope ?? request.query?.scope
    if (typeof slug !== 'string' || !scope) {
      throw new NotFoundException()
    }

    const [org, entity] = await Promise.all([
      this.campaigns.client.organization.findFirst({
        where: { slug, ownerId: userId },
      }),
      CAMPAIGN_SCOPES.has(scope)
        ? this.campaigns.findFirst({
            where: { organizationSlug: slug, userId },
          })
        : this.electedOffices.findFirst({
            where: { organizationSlug: slug, userId },
          }),
    ])
    if (!org || !entity) {
      throw new NotFoundException()
    }

    request.chatOrganizationSlug = slug
    return true
  }
}

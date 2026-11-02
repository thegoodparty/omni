import { Controller, Get, UseInterceptors } from '@nestjs/common'
import {
  ROBOCALL_FREE_OFFER_VARIANT,
  RobocallFreeOfferResponseSchema,
  type RobocallFreeOfferResponse,
} from '@goodparty_org/contracts'
import { Organization } from '../generated/prisma'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ROBOCALL_FREE_OFFER_COVERED_CALLS } from '@/robocallFreeOffer/robocallFreeOffer.consts'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { RecommendedListsService } from './services/recommendedLists.service'

const NOT_OFFERED: RobocallFreeOfferResponse = {
  eligible: false,
  variant: ROBOCALL_FREE_OFFER_VARIANT,
  count: null,
  coveredCalls: null,
}

// Whether the campaign gets the free election-eve robocall right now, and
// the size of its offer list. Every surface that shows the offer reads this
// one answer, and the first call for an eligible campaign assigns its
// precincts. Here rather than in RobocallFreeOfferModule because the count
// is the offer list's own, sized like every other recommendation.
@Controller('campaigns/mine/robocall-offer')
@UseOrganization()
@UseInterceptors(ZodResponseInterceptor)
export class RobocallFreeOfferController {
  constructor(
    private readonly recommendedLists: RecommendedListsService,
    private readonly campaigns: CampaignsService,
  ) {}

  @Get()
  @ResponseSchema(RobocallFreeOfferResponseSchema)
  async get(
    @ReqOrganization() organization: Organization,
  ): Promise<RobocallFreeOfferResponse> {
    // Serve has no campaign and no offer; a plain "no" keeps the Home card
    // from erroring on an elected official's dashboard.
    if (organization.slug.startsWith('eo-')) return NOT_OFFERED

    const campaign = await this.campaigns.findFirstOrThrow({
      where: { organizationSlug: organization.slug },
    })
    const [offer] = await this.recommendedLists.recommend(
      organization,
      campaign,
      'robocall',
      null,
      ROBOCALL_FREE_OFFER_VARIANT,
    )
    if (!offer) return NOT_OFFERED
    return {
      eligible: true,
      variant: ROBOCALL_FREE_OFFER_VARIANT,
      count: offer.count,
      coveredCalls: ROBOCALL_FREE_OFFER_COVERED_CALLS,
    }
  }
}

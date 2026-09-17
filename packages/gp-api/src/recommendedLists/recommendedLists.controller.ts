import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseInterceptors,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { RecommendedListsResponseSchema } from '@goodparty_org/contracts'
import { Organization } from '../generated/prisma'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import {
  GetRecommendedListsQuerySchema,
  type GetRecommendedListsQuery,
} from './schemas/getRecommendedLists.schema'
import { RecommendedListsService } from './services/recommendedLists.service'

@Controller('campaigns/mine/recommended-lists')
@UseOrganization()
@UseInterceptors(ZodResponseInterceptor)
export class RecommendedListsController {
  constructor(
    private readonly recommendedLists: RecommendedListsService,
    private readonly campaigns: CampaignsService,
  ) {}

  @Get()
  @ResponseSchema(RecommendedListsResponseSchema)
  async get(
    @ReqOrganization() organization: Organization,
    @Query(new ZodValidationPipe(GetRecommendedListsQuerySchema))
    { channel, intent }: GetRecommendedListsQuery,
  ) {
    // The primary gate, ahead of the service's own defence-in-depth 400:
    // an `eo-` (Serve) org has no Campaign row to resolve below, so this
    // has to run first rather than fall out of a failed lookup.
    if (organization.slug.startsWith('eo-')) {
      throw new BadRequestException(
        'Recommended lists are not available for this organization',
      )
    }

    const campaign = await this.campaigns.findFirstOrThrow({
      where: { organizationSlug: organization.slug },
    })

    return this.recommendedLists.recommend(
      organization,
      campaign,
      channel,
      intent ?? null,
    )
  }
}

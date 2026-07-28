import { Controller, Get, UseInterceptors, UsePipes } from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  RecommendedListsResponse,
  RecommendedListsResponseSchema,
} from '@goodparty_org/contracts'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { RecommendedListsService } from './services/recommendedLists.service'

@Controller('campaigns/mine/recommended-lists')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class RecommendedListsController {
  constructor(private readonly recommendedLists: RecommendedListsService) {}

  @Get()
  @ResponseSchema(RecommendedListsResponseSchema)
  @UseCampaign({ include: { user: true } })
  async get(
    @ReqCampaign() campaign: CampaignWith<'user'>,
  ): Promise<RecommendedListsResponse> {
    return this.recommendedLists.getForCampaign(campaign)
  }
}

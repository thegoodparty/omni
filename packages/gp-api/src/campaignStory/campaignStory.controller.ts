import { Body, Controller, Get, Put, UseInterceptors } from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { Campaign } from '../generated/prisma'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { CampaignStory, CampaignStorySchema } from '@goodparty_org/contracts'
import { CampaignStoryService } from './services/campaignStory.service'
import {
  UpdateCampaignStoryInput,
  UpdateCampaignStorySchema,
} from './schemas/updateCampaignStory.schema'

@Controller('campaigns/mine/story')
@UseCampaign()
@UseInterceptors(ZodResponseInterceptor)
export class CampaignStoryController {
  constructor(private readonly campaignStory: CampaignStoryService) {}

  @Get()
  @ResponseSchema(CampaignStorySchema)
  get(@ReqCampaign() campaign: Campaign): Promise<CampaignStory> {
    return this.campaignStory.getForCampaign(campaign.id)
  }

  @Put()
  @ResponseSchema(CampaignStorySchema)
  update(
    @ReqCampaign() campaign: Campaign,
    @Body(new ZodValidationPipe(UpdateCampaignStorySchema))
    input: UpdateCampaignStoryInput,
  ): Promise<CampaignStory> {
    return this.campaignStory.upsertForCampaign(campaign.id, input)
  }
}

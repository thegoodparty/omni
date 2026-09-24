import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  UseInterceptors,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { Campaign } from '../generated/prisma'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { ownerCandidateName } from '@/campaigns/util/ownerCandidateName.util'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import {
  CampaignStory,
  CampaignStoryRewrite,
  CampaignStoryRewriteSchema,
  CampaignStorySchema,
} from '@goodparty_org/contracts'
import { CampaignStoryService } from './services/campaignStory.service'
import { CampaignStoryRewriteService } from './services/campaignStoryRewrite.service'
import {
  UpdateCampaignStoryInput,
  UpdateCampaignStorySchema,
} from './schemas/updateCampaignStory.schema'
import {
  RewriteCampaignStoryInput,
  RewriteCampaignStorySchema,
} from './schemas/rewriteCampaignStory.schema'

@Controller('campaigns/mine/story')
// The story is voiced by the campaign OWNER, not the requester — a Campaign
// Manager's rewrite must not re-voice it as themselves (ENG-11139), so the
// owner relation rides every campaign load here.
@UseCampaign({ include: { user: true } })
@UseInterceptors(ZodResponseInterceptor)
export class CampaignStoryController {
  constructor(
    private readonly campaignStory: CampaignStoryService,
    private readonly campaignStoryRewrite: CampaignStoryRewriteService,
  ) {}

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

  @Post('rewrite')
  @ResponseSchema(CampaignStoryRewriteSchema)
  rewrite(
    @ReqCampaign() campaign: CampaignWith<'user'>,
    @Body(new ZodValidationPipe(RewriteCampaignStorySchema))
    input: RewriteCampaignStoryInput,
  ): Promise<CampaignStoryRewrite> {
    return this.campaignStoryRewrite.rewrite(
      input,
      ownerCandidateName(campaign),
      campaign.id,
    )
  }
}

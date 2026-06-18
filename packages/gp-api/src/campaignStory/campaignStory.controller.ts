import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  UseInterceptors,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { Campaign, User } from '../generated/prisma'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
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

const candidateName = (user: User): string =>
  [user.firstName, user.lastName].filter(Boolean).join(' ').trim()

@Controller('campaigns/mine/story')
@UseCampaign()
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
    @ReqUser() user: User,
    @Body(new ZodValidationPipe(RewriteCampaignStorySchema))
    input: RewriteCampaignStoryInput,
  ): Promise<CampaignStoryRewrite> {
    return this.campaignStoryRewrite.rewrite(input, candidateName(user))
  }
}

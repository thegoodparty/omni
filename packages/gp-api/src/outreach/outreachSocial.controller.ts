import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseInterceptors,
} from '@nestjs/common'
import {
  OutreachDetail,
  OutreachDetailSchema,
  SocialDraftRequest,
  SocialDraftRequestSchema,
  SocialDraftResponse,
  SocialDraftResponseSchema,
  SocialGenerateRequest,
  SocialGenerateRequestSchema,
  SocialGenerateResponse,
  SocialGenerateResponseSchema,
  SocialSaveRequest,
  SocialSaveRequestSchema,
} from '@goodparty_org/contracts'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { Campaign, User } from '../generated/prisma'
import { OutreachSocialService } from './services/outreachSocial.service'
import { OutreachSocialGenerationService } from './services/outreachSocialGeneration.service'

const candidateName = (user: User): string =>
  [user.firstName, user.lastName].filter(Boolean).join(' ').trim()

// GET :id lives here rather than on OutreachController so detail reads stay
// outside OutreachNotificationInterceptor — a 404 there fires a CAS failure
// Slack meant for send attempts.
@Controller('outreach')
@UseCampaign()
@UseInterceptors(ZodResponseInterceptor)
export class OutreachSocialController {
  constructor(
    private readonly socialService: OutreachSocialService,
    private readonly generationService: OutreachSocialGenerationService,
  ) {}

  @Post('social/draft')
  @ResponseSchema(SocialDraftResponseSchema)
  async draft(
    @ReqUser() user: User,
    @ReqCampaign() campaign: Campaign,
    @Body(new ZodValidationPipe(SocialDraftRequestSchema))
    input: SocialDraftRequest,
  ): Promise<SocialDraftResponse> {
    return {
      draft: await this.generationService.generateDraft(
        input,
        candidateName(user),
        campaign.details.normalizedOffice ?? '',
        String(user.id),
      ),
    }
  }

  @Post('social/generate')
  @ResponseSchema(SocialGenerateResponseSchema)
  async generate(
    @ReqUser() user: User,
    @Body(new ZodValidationPipe(SocialGenerateRequestSchema))
    input: SocialGenerateRequest,
  ): Promise<SocialGenerateResponse> {
    return {
      assets: await this.generationService.generateAssets(
        input,
        candidateName(user),
        String(user.id),
      ),
    }
  }

  @Post('social')
  @ResponseSchema(OutreachDetailSchema)
  save(
    @ReqCampaign() campaign: Campaign,
    @Body(new ZodValidationPipe(SocialSaveRequestSchema))
    input: SocialSaveRequest,
  ): Promise<OutreachDetail> {
    return this.socialService.saveSocialOutreach(campaign, input)
  }

  @Get(':id')
  @ResponseSchema(OutreachDetailSchema)
  detail(
    @ReqCampaign() campaign: Campaign,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<OutreachDetail> {
    return this.socialService.findDetail(campaign.id, id)
  }
}

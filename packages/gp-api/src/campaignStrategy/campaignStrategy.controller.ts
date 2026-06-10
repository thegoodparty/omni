import {
  Controller,
  Get,
  HttpStatus,
  Post,
  Res,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { FastifyReply } from 'fastify'
import { PinoLogger } from 'nestjs-pino'
import { ZodValidationPipe } from 'nestjs-zod'
import { Campaign } from '../generated/prisma'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { CampaignStrategyService } from './services/campaignStrategy.service'
import {
  CommunityEventsResponse,
  CommunityEventsResponseSchema,
} from '@goodparty_org/contracts'
import {
  StrategicLandscapeResponse,
  StrategicLandscapeResponseSchema,
} from './schemas/strategicLandscape.schema'
import {
  StrategyExistsResponse,
  StrategyExistsResponseSchema,
} from './schemas/strategyExists.schema'

@Controller('campaignStrategy')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class CampaignStrategyController {
  constructor(
    private readonly campaignStrategy: CampaignStrategyService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CampaignStrategyController.name)
  }

  // Cheap existence probe for UI gating (the dashboard's Campaign Plan tab).
  // Deliberately a dedicated endpoint rather than a field on the campaign
  // payload: cached campaign objects get overwritten by responses that lack
  // computed fields, which made campaign-derived gating unreliable.
  @Get('mine/exists')
  @ResponseSchema(StrategyExistsResponseSchema)
  @UseCampaign()
  async strategyExists(
    @ReqCampaign() campaign: Campaign,
  ): Promise<StrategyExistsResponse> {
    return {
      exists: await this.campaignStrategy.existsForCampaign(campaign.id),
    }
  }

  @Post('mine/strategic-landscape')
  @ResponseSchema(StrategicLandscapeResponseSchema)
  @UseCampaign({ include: { user: true } })
  async generateStrategicLandscape(
    @ReqCampaign() campaign: CampaignWith<'user'>,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<StrategicLandscapeResponse> {
    const response =
      await this.campaignStrategy.getOrGenerateStrategicLandscape(campaign)
    if (response.status === 'generating') {
      res.status(HttpStatus.ACCEPTED)
    }
    return response
  }

  @Post('mine/community-events')
  @ResponseSchema(CommunityEventsResponseSchema)
  @UseCampaign({ include: { user: true } })
  async generateCommunityEvents(
    @ReqCampaign() campaign: CampaignWith<'user'>,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<CommunityEventsResponse> {
    const response =
      await this.campaignStrategy.getOrGenerateCommunityEvents(campaign)
    if (response.status === 'generating') {
      res.status(HttpStatus.ACCEPTED)
    }
    return response
  }
}

import {
  Controller,
  Get,
  Post,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  RaceOpponentResponse,
  RaceOpponentResponseSchema,
} from '@goodparty_org/contracts'
import { ReqCampaign } from '@/campaigns/decorators/ReqCampaign.decorator'
import { UseCampaign } from '@/campaigns/decorators/UseCampaign.decorator'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { RaceOpponentService } from './services/raceOpponent.service'
import {
  RaceOpponentCollectResponse,
  RaceOpponentCollectResponseSchema,
} from './schemas/raceOpponentCollect.schema'

@Controller('campaigns/mine/race-opponent')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class RaceOpponentController {
  constructor(private readonly raceOpponent: RaceOpponentService) {}

  @Post('collect')
  @ResponseSchema(RaceOpponentCollectResponseSchema)
  @UseCampaign({ include: { user: true } })
  async collect(
    @ReqCampaign() campaign: CampaignWith<'user'>,
  ): Promise<RaceOpponentCollectResponse> {
    return this.raceOpponent.collect(campaign)
  }

  @Get()
  @ResponseSchema(RaceOpponentResponseSchema)
  @UseCampaign({ include: { user: true } })
  async get(
    @ReqCampaign() campaign: CampaignWith<'user'>,
  ): Promise<RaceOpponentResponse> {
    return this.raceOpponent.get(campaign)
  }
}

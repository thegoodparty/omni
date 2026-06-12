import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import {
  Controller,
  Get,
  NotFoundException,
  Query,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { PinoLogger } from 'nestjs-pino'
import { FindByRaceIdDto } from '../schemas/public/FindByRaceId.schema'
import { FindByRaceIdResponseSchema } from '../schemas/public/FindByRaceIdResponse.schema'
import { PublicCampaignsService } from '../services/public-campaigns.service'

@Controller('public-campaigns')
@PublicAccess()
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class PublicCampaignsController {
  constructor(
    private readonly publicCampaignsService: PublicCampaignsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PublicCampaignsController.name)
  }

  @Get()
  @ResponseSchema(FindByRaceIdResponseSchema)
  async findByRaceId(@Query() dto: FindByRaceIdDto) {
    this.logger.debug(
      `Finding campaign by race ID: ${dto.raceId}, name: ${dto.firstName} ${dto.lastName}`,
    )

    const result = await this.publicCampaignsService.findCampaignByRaceId(dto)

    if (!result) {
      throw new NotFoundException('No matching campaign found')
    }

    return result
  }
}

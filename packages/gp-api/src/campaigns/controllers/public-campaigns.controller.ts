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
  ) {}

  // The per-request debug line this used to emit restated raceId, firstName
  // and lastName, all of which the framework's own request log already carries
  // in the query string — 123k duplicate lines a day, including candidate
  // names, for a route whose useful signal is its error rate.
  @Get()
  @ResponseSchema(FindByRaceIdResponseSchema)
  async findByRaceId(@Query() dto: FindByRaceIdDto) {
    const result = await this.publicCampaignsService.findCampaignByRaceId(dto)

    if (!result) {
      throw new NotFoundException('No matching campaign found')
    }

    return result
  }
}

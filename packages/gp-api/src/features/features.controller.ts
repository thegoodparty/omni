import { Controller, Get } from '@nestjs/common'
import {
  ExperimentVariantsResponse,
  ExperimentVariantsResponseSchema,
} from '@goodparty_org/contracts'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { User } from '../generated/prisma'
import { FeaturesService } from './services/features.service'

@Controller('experiment')
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  @Get('variants')
  @ResponseSchema(ExperimentVariantsResponseSchema)
  async getVariants(
    @ReqUser() user: User,
  ): Promise<ExperimentVariantsResponse> {
    return { variants: await this.features.getAllVariants(user) }
  }
}

import { Controller, Get, UnauthorizedException } from '@nestjs/common'
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
    @ReqUser() user: User | undefined,
  ): Promise<ExperimentVariantsResponse> {
    // SessionGuard lets M2M (mt_*) tokens through without setting request.user,
    // so reject them explicitly rather than NPE in getAllVariants(undefined).
    if (!user) {
      throw new UnauthorizedException()
    }
    return { variants: await this.features.getAllVariants(user) }
  }
}

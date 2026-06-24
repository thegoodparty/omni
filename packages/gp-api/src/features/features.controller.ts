import { Controller, Get } from '@nestjs/common'
import {
  ExperimentVariantsResponse,
  ExperimentVariantsResponseSchema,
} from '@goodparty_org/contracts'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { User } from '../generated/prisma'
import { FeaturesService } from './services/features.service'

// gp-api applies a global 'v1' prefix (app.ts), so the controller path must NOT
// repeat it — '/experiment' resolves to /v1/experiment, matching the webapp's
// `GET /v1/experiment/variants`. (It was 'v1/experiment', which double-prefixed
// to /v1/v1/experiment/variants and 404'd, silently forcing the client Amplitude
// fallback this endpoint exists to remove.)
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

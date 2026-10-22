import { Controller, Get, UnauthorizedException } from '@nestjs/common'
import {
  ExperimentVariantsResponse,
  ExperimentVariantsResponseSchema,
} from '@goodparty_org/contracts'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { AllowVolunteer } from '@/organizations/decorators/AllowVolunteer.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { Organization, User } from '../generated/prisma'
import { FeaturesService } from './services/features.service'

@Controller('experiment')
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  // The org decides its org-scoped flags. Every page seeds from this call,
  // so a slug the user is no member of reads as no org rather than a 404,
  // and a volunteer is admitted like anyone else.
  @Get('variants')
  @UseOrganization({ continueIfNotFound: true })
  @AllowVolunteer()
  @ResponseSchema(ExperimentVariantsResponseSchema)
  async getVariants(
    @ReqUser() user: User | undefined,
    @ReqOrganization() organization: Organization | undefined,
  ): Promise<ExperimentVariantsResponse> {
    // SessionGuard lets M2M (mt_*) tokens through without setting request.user,
    // so reject them explicitly rather than NPE in getAllVariants(undefined).
    if (!user) {
      throw new UnauthorizedException()
    }
    return {
      variants: await this.features.getAllVariants(user, organization),
    }
  }
}

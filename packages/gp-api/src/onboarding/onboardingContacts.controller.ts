import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { PublicAccess } from 'src/authentication/decorators/PublicAccess.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { ContactsService } from '@/contacts/services/contacts.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { AllowVolunteer } from '@/organizations/decorators/AllowVolunteer.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { Organization } from '../generated/prisma'
import {
  GetOnboardingStatsQueryDTO,
  onboardingStatsResponseSchema,
} from './schemas/getOnboardingStats.schema'

@Controller('onboarding/contacts')
@PublicAccess()
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class OnboardingContactsController {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly organizations: OrganizationsService,
  ) {}

  @Get('stats')
  @UseOrganization({ continueIfNotFound: true })
  // @PublicAccess route: a volunteer sending the org header must not be
  // 403'd by the role guard on an endpoint anonymous callers can reach.
  @AllowVolunteer()
  @ResponseSchema(onboardingStatsResponseSchema)
  async getOnboardingStats(
    @Query() query: GetOnboardingStatsQueryDTO,
    @ReqOrganization() organization?: Organization,
  ) {
    let districtId = query.districtId

    if (!districtId && query.ballotReadyPositionId) {
      districtId = await this.contactsService.resolveDistrictIdFromPosition(
        query.ballotReadyPositionId,
      )
    }

    // The webapp can only supply a BR position id from the onboarding-time
    // snapshot, which goes stale when the user edits their race. The
    // organization's position pointer IS maintained on race edits, so for
    // authenticated callers that send no params, derive the district from
    // it server-side — same pattern as the voter-issues endpoint.
    if (!districtId && organization) {
      const { district } =
        await this.organizations.getDistrictAndLevelForOrgSlug(
          organization.slug,
        )
      districtId = district?.id
    }

    if (!districtId) {
      throw new BadRequestException(
        'Could not resolve a district from the provided' +
          ' districtId or ballotReadyPositionId',
      )
    }

    return this.contactsService.fetchStatsByDistrictId(districtId)
  }
}

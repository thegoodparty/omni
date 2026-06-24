import {
  Controller,
  Get,
  Query,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { Organization, User } from '../generated/prisma'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import {
  GetLocalNewsQueryDTO,
  localNewsResponseSchema,
  LocalNewsResponse,
} from './schemas/getLocalNews.schema'
import { OnboardingLocalNewsService } from './services/localNews.service'
import { isTestUser } from '@/users/util/users.util'

@Controller('onboarding/local-news')
@UsePipes(ZodValidationPipe)
@UseInterceptors(ZodResponseInterceptor)
export class OnboardingLocalNewsController {
  constructor(private readonly localNewsService: OnboardingLocalNewsService) {}

  @Get()
  @UseOrganization()
  @ResponseSchema(localNewsResponseSchema)
  async getLocalNews(
    @Query() query: GetLocalNewsQueryDTO,
    @ReqOrganization() organization: Organization,
    @ReqUser() user: User,
  ): Promise<LocalNewsResponse> {
    if (isTestUser({ email: user.email })) {
      return { status: 'ready', outlets: [] }
    }
    return this.localNewsService.getLocalNews({
      city: query.city,
      state: query.state,
      office: query.office,
      userId: organization.ownerId,
    })
  }
}

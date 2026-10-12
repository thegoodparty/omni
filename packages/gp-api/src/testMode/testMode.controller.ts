import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import {
  ApplyTestModeRequest,
  ApplyTestModeRequestSchema,
  CreateTestOrganizationRequest,
  CreateTestOrganizationRequestSchema,
  TestModeState,
  TestModeStateSchema,
} from '@goodparty_org/contracts'
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { Organization, User } from '../generated/prisma'
import { TestModeGuard } from './guards/TestMode.guard'
import { TestModeService } from './services/testMode.service'

@Controller('test-mode')
@UseGuards(TestModeGuard)
@UseInterceptors(ZodResponseInterceptor)
export class TestModeController {
  constructor(private readonly testMode: TestModeService) {}

  @Get()
  @UseOrganization({ continueIfNotFound: true })
  @ResponseSchema(TestModeStateSchema)
  getState(
    @ReqUser() user: User,
    @ReqOrganization() organization?: Organization,
  ): Promise<TestModeState> {
    return this.testMode.getState(user, organization?.slug)
  }

  @Post('organizations')
  @ResponseSchema(TestModeStateSchema)
  createOrganization(
    @ReqUser() user: User,
    @Body(new ZodValidationPipe(CreateTestOrganizationRequestSchema))
    body: CreateTestOrganizationRequest,
  ): Promise<TestModeState> {
    return this.testMode.createOrganization(user, body)
  }

  @Post('apply')
  @HttpCode(HttpStatus.OK)
  @UseOrganization()
  @ResponseSchema(TestModeStateSchema)
  apply(
    @ReqUser() user: User,
    @ReqOrganization() organization: Organization,
    @Body(new ZodValidationPipe(ApplyTestModeRequestSchema))
    body: ApplyTestModeRequest,
  ): Promise<TestModeState> {
    return this.testMode.apply(user, organization, body)
  }

  @Delete('organizations/:slug')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(TestModeStateSchema)
  deleteOrganization(
    @ReqUser() user: User,
    @Param('slug') slug: string,
  ): Promise<TestModeState> {
    return this.testMode.deleteOrganization(user, slug)
  }
}

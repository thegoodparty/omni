import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import {
  IS_NON_PROD_DEPLOY,
  VENDOR_MODE,
} from '@/shared/util/appEnvironment.util'
import { isTestUser } from '@/users/util/users.util'
import {
  AdminOutreachActionRequestSchema,
  AdminOutreachActionResponseSchema,
  type AdminOutreachActionRequest,
  DeliverStripeEventRequestSchema,
  DeliverStripeEventResponseSchema,
  type DeliverStripeEventRequest,
  type MockAction,
  MockActionResponseSchema,
  MockActionSchema,
  type MockRecordsQuery,
  MockRecordsQuerySchema,
  MockRecordsResponseSchema,
  RunJobResponseSchema,
  type TimeTravel,
  TimeTravelResponseSchema,
  TimeTravelSchema,
} from '@goodparty_org/contracts'
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { User } from '@/generated/prisma'
import { CampaignTcrComplianceService } from '@/campaigns/tcrCompliance/services/campaignTcrCompliance.service'
import { TestFixturesService } from './services/testFixtures.service'

// Vendor-mock fixture endpoints callable by a normal signed-in E2E test user.
// Separated from TestFixturesController (class-level AdminOrM2MGuard) so that
// Playwright specs can arm mock flags using the test user's own session token
// without needing admin credentials.
@Controller('test-fixtures/vendor-mocks')
export class TestFixturesVendorMocksController {
  constructor(
    private readonly testFixtures: TestFixturesService,
    private readonly campaigns: CampaignsService,
    private readonly tcrCompliance: CampaignTcrComplianceService,
  ) {}

  @Post('actions')
  @ResponseSchema(MockActionResponseSchema)
  async vendorMockAction(
    @Body(new ZodValidationPipe(MockActionSchema)) body: MockAction,
    @ReqUser() user: User,
  ) {
    this.assertNonProdDeploy()
    await this.assertCampaignOwner(body.campaignId, user.id)
    return this.testFixtures.applyMockAction(body)
  }

  @Get('records')
  @ResponseSchema(MockRecordsResponseSchema)
  async vendorMockRecords(
    @Query(new ZodValidationPipe(MockRecordsQuerySchema)) q: MockRecordsQuery,
    @ReqUser() user: User,
  ) {
    this.assertNonProdDeploy()
    await this.assertCampaignOwner(q.campaignId, user.id)
    return this.testFixtures.getMockRecords(q.campaignId)
  }

  // Test-user variant of the admin run-job route. These sweeps are global,
  // so a call processes every eligible row on the preview, not just the
  // caller's. Acceptable on an ephemeral preview because only the robocall
  // E2E spec creates robocall runs.
  @Post('jobs/:name/run')
  @ResponseSchema(RunJobResponseSchema)
  async testUserRunJob(@Param('name') name: string, @ReqUser() user: User) {
    this.assertNonProdDeploy()
    if (!user.email || !isTestUser({ email: user.email })) {
      throw new ForbiddenException('Test users only')
    }
    return this.testFixtures.runJob(name, user.id)
  }

  @Post('time-travel')
  @ResponseSchema(TimeTravelResponseSchema)
  async timeTravel(
    @Body(new ZodValidationPipe(TimeTravelSchema)) body: TimeTravel,
    @ReqUser() user: User,
  ) {
    this.assertNonProdDeploy()
    return this.testFixtures.timeTravel(body, user.id)
  }

  @Post('stripe/events')
  @ResponseSchema(DeliverStripeEventResponseSchema)
  async deliverStripeEvent(
    @Body(new ZodValidationPipe(DeliverStripeEventRequestSchema))
    body: DeliverStripeEventRequest,
    @ReqUser() user: User,
  ) {
    this.assertNonProdDeploy()
    if (!user.email || !isTestUser({ email: user.email })) {
      throw new ForbiddenException('Test users only')
    }
    return this.testFixtures.deliverStripeEvent(body.type, body.sessionId)
  }

  // Stands in for the staff "override CV validation" step. The pre-submission
  // gate fetches the candidate's filing URL live and asks an LLM about it, so a
  // fixture candidate can never pass it. Only the caller's own campaign is
  // touched (no id is taken from the request), and only where the vendors are
  // mocked.
  @Post('cv-validation/override')
  @HttpCode(HttpStatus.NO_CONTENT)
  async overrideCvValidation(@ReqUser() user: User) {
    this.assertNonProdDeploy()
    if (VENDOR_MODE !== 'mock') {
      throw new NotFoundException()
    }
    if (!user.email || !isTestUser({ email: user.email })) {
      throw new ForbiddenException('Test users only')
    }
    const campaign = await this.campaigns.findFirst({
      where: { userId: user.id },
    })
    if (!campaign) {
      throw new NotFoundException()
    }
    await this.tcrCompliance.overrideCvValidation(campaign.id)
  }

  @Post('outreach/:id/admin-actions')
  @ResponseSchema(AdminOutreachActionResponseSchema)
  async outreachAdminAction(
    @Param('id', ParseIntPipe) outreachId: number,
    @Body(new ZodValidationPipe(AdminOutreachActionRequestSchema))
    body: AdminOutreachActionRequest,
    @ReqUser() user: User,
  ) {
    this.assertNonProdDeploy()
    if (!user.email || !isTestUser({ email: user.email })) {
      throw new ForbiddenException('Test users only')
    }
    await this.assertOutreachOwner(outreachId, user.id)
    return this.testFixtures.applyOutreachAdminAction(
      outreachId,
      body.action,
      body.payload,
      user.id,
    )
  }

  // Checks that the campaign belongs to the signed-in user; 403 otherwise.
  // 404 when the campaign doesn't exist so callers can't enumerate ids.
  private async assertCampaignOwner(campaignId: number, userId: number) {
    const campaign = await this.campaigns.findFirst({
      where: { id: campaignId },
    })
    if (!campaign) {
      throw new NotFoundException()
    }
    if (campaign.userId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to access this campaign',
      )
    }
  }

  // Checks that the outreach belongs to a campaign owned by the signed-in user.
  // 404 when no campaign is found so callers can't enumerate ids.
  private async assertOutreachOwner(outreachId: number, userId: number) {
    const outreach = await this.campaigns.client.outreach.findUnique({
      where: { id: outreachId },
    })
    if (!outreach || outreach.campaignId === null) {
      throw new NotFoundException()
    }
    const campaign = await this.campaigns.findFirst({
      where: { id: outreach.campaignId },
    })
    if (!campaign) {
      throw new NotFoundException()
    }
    if (campaign.userId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to access this outreach',
      )
    }
  }

  // Fail-closed to the known non-prod deploys, and 404 rather than 403 so the
  // controller doesn't advertise itself in prod. Local use requires
  // OTEL_SERVICE_ENVIRONMENT=dev.
  private assertNonProdDeploy() {
    if (!IS_NON_PROD_DEPLOY) {
      throw new NotFoundException()
    }
  }
}

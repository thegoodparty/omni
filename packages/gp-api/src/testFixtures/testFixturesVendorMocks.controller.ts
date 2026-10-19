import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { IS_NON_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'
import {
  type MockAction,
  MockActionResponseSchema,
  MockActionSchema,
  type MockRecordsQuery,
  MockRecordsQuerySchema,
  MockRecordsResponseSchema,
} from '@goodparty_org/contracts'
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { User } from '@/generated/prisma'
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

  // Fail-closed to the known non-prod deploys, and 404 rather than 403 so the
  // controller doesn't advertise itself in prod. Local use requires
  // OTEL_SERVICE_ENVIRONMENT=dev.
  private assertNonProdDeploy() {
    if (!IS_NON_PROD_DEPLOY) {
      throw new NotFoundException()
    }
  }
}

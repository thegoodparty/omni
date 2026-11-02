import { NonProdDeployOnly } from './guards/NonProdDeploy.guard'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { IS_NON_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'
import { User } from '@/generated/prisma'
import { isTestUser } from '@/users/util/users.util'
import { TestFixtureStateResponseSchema } from '@goodparty_org/contracts'
import {
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common'
import { TestFixturesService } from './services/testFixtures.service'

// Applies a fixture state to an existing user. Callable by the signed-in test
// user themselves (like the vendor-mock routes), so a Playwright spec that
// registered its own user can upgrade it without admin credentials. Separate
// from TestFixturesController, whose class-level AdminOrM2MGuard would block it.
@Controller('test-fixtures/users/:id/states')
@NonProdDeployOnly()
export class TestFixturesStatesController {
  constructor(private readonly testFixtures: TestFixturesService) {}

  // Runs the real 10DLC registration against the vendor mocks and ends at
  // `tcr_approved`. 400s unless VENDOR_MODE=mock (checked in the service).
  @Post('pro-win-10dlc-mock')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(TestFixtureStateResponseSchema)
  applyProWin10DlcMock(
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() user: User,
  ) {
    this.assertNonProdDeploy()
    if (!user.email || !isTestUser({ email: user.email })) {
      throw new ForbiddenException('Test users only')
    }
    // Only the caller's own user; 404 rather than 403 so ids can't be probed.
    if (user.id !== id) {
      throw new NotFoundException()
    }
    return this.testFixtures.setupProWin10DlcMock(id)
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

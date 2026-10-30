import { NonProdDeployOnly } from './guards/NonProdDeploy.guard'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { IS_NON_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'
import {
  DeleteTestFixtureUsersResponseSchema,
  RunJobResponseSchema,
  SeedTestFixtureActivityRequestSchema,
  SeedTestFixtureActivityResponseSchema,
  type SeedTestFixtureActivityRequest,
  TestFixtureSessionResponseSchema,
  TestFixtureUserResponseSchema,
} from '@goodparty_org/contracts'
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  CreateTestFixtureUserInput,
  CreateTestFixtureUserSchema,
  DeleteTestFixtureUsersInput,
  DeleteTestFixtureUsersSchema,
  MintTestFixtureSessionInput,
  MintTestFixtureSessionSchema,
} from './schemas/testFixtures.schema'
import { ActivitySeedService } from './services/activitySeed.service'
import { TestFixturesService } from './services/testFixtures.service'

// Test-only fixture provisioning for automated feature QA: mints
// qa-<uuid>@goodparty.org users (real internal domain, so internal-targeted
// feature flags apply) in a known product state with working browser
// credentials, and cleans them up on demand (the deleteTestUsers cron is the
// safety net). Responses carry credentials by contract — never log them.
@Controller('test-fixtures')
@NonProdDeployOnly()
@UseGuards(AdminOrM2MGuard)
export class TestFixturesController {
  constructor(
    private readonly testFixtures: TestFixturesService,
    private readonly activitySeed: ActivitySeedService,
  ) {}

  @Post('users')
  @ResponseSchema(TestFixtureUserResponseSchema)
  createUser(
    @Body(new ZodValidationPipe(CreateTestFixtureUserSchema))
    body: CreateTestFixtureUserInput,
  ) {
    this.assertNonProdDeploy()
    return this.testFixtures.createFixtureUser(body)
  }

  @Delete('users')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(DeleteTestFixtureUsersResponseSchema)
  deleteUsers(
    @Body(new ZodValidationPipe(DeleteTestFixtureUsersSchema))
    body: DeleteTestFixtureUsersInput,
  ) {
    this.assertNonProdDeploy()
    return this.testFixtures.deleteFixtureUsers(body)
  }

  @Post('users/:id/session')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(TestFixtureSessionResponseSchema)
  mintSession(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(MintTestFixtureSessionSchema))
    body: MintTestFixtureSessionInput,
  ) {
    this.assertNonProdDeploy()
    return this.testFixtures.mintFixtureSession(id, body)
  }

  @Post('organizations/:slug/activity')
  @ResponseSchema(SeedTestFixtureActivityResponseSchema)
  seedActivity(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(SeedTestFixtureActivityRequestSchema))
    body: SeedTestFixtureActivityRequest,
  ) {
    this.assertNonProdDeploy()
    return this.activitySeed.seed(slug, body)
  }

  @Post('jobs/:name/run')
  @ResponseSchema(RunJobResponseSchema)
  runJob(@Param('name') name: string) {
    this.assertNonProdDeploy()
    return this.testFixtures.runJob(name)
  }

  // Fail-closed to the known non-prod deploys, and 404 rather than 403 so the
  // controller doesn't advertise itself in prod (campaignTracker's generate
  // route pattern). Local use requires OTEL_SERVICE_ENVIRONMENT=dev.
  private assertNonProdDeploy() {
    if (!IS_NON_PROD_DEPLOY) {
      throw new NotFoundException()
    }
  }
}

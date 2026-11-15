import { NonProdDeployOnly } from './guards/NonProdDeploy.guard'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { User } from '@/generated/prisma'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { IS_NON_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'
import { isTestUser } from '@/users/util/users.util'
import {
  ApplyTestFixtureElectionRequestSchema,
  ApplyTestFixtureElectionResponseSchema,
  type ApplyTestFixtureElectionRequest,
  RaceListItemSchema,
  TestFixtureRaceQuerySchema,
  type TestFixtureRaceQuery,
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
import { StateTransitionsService } from './services/stateTransitions.service'
import { TestFixturesService } from './services/testFixtures.service'

// Scenario building blocks a Playwright spec calls with its own test user's
// token: resolve the pinned office, then declare the campaign's election
// state. Separate from TestFixturesController, whose class-level
// AdminOrM2MGuard would block a test user.
@Controller('test-fixtures')
@NonProdDeployOnly()
export class TestFixturesScenariosController {
  constructor(
    private readonly testFixtures: TestFixturesService,
    private readonly transitions: StateTransitionsService,
  ) {}

  @Get('races/resolve')
  @ResponseSchema(RaceListItemSchema)
  resolveRace(
    @Query(new ZodValidationPipe(TestFixtureRaceQuerySchema))
    query: TestFixtureRaceQuery,
    @ReqUser() user: User,
  ) {
    this.assertTestUserOffProd(user)
    return this.transitions.findRace(query)
  }

  @Post('campaigns/:id/election')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(ApplyTestFixtureElectionResponseSchema)
  applyElection(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(ApplyTestFixtureElectionRequestSchema))
    body: ApplyTestFixtureElectionRequest,
    @ReqUser() user: User,
  ) {
    this.assertTestUserOffProd(user)
    return this.testFixtures.applyElectionPreset(user.id, id, body.preset)
  }

  // Fail-closed to the known non-prod deploys, and 404 rather than 403 so the
  // controller doesn't advertise itself in prod.
  private assertTestUserOffProd(user: User) {
    if (!IS_NON_PROD_DEPLOY) {
      throw new NotFoundException()
    }
    if (!user.email || !isTestUser({ email: user.email })) {
      throw new ForbiddenException('Test users only')
    }
  }
}

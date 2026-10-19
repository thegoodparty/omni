import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { IS_NON_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'
import { CaseListError } from './judgeChatFixture/accountState'
import { User } from '@/generated/prisma'
import {
  JudgeChatCaseResponseSchema,
  JudgeChatCaseSlugSchema,
  SetUpJudgeChatCaseSchema,
  TearDownJudgeChatCaseResponseSchema,
  type SetUpJudgeChatCaseInput,
} from './schemas/judgeChatFixture.schema'
import { JudgeChatFixtureService } from './services/judgeChatFixture.service'

// Stages one Universal Judge chat case inside a deployed non-prod environment.
// A judge arm that drives a PR preview over HTTP has no Prisma client of its
// own — the preview owns its gpdb_pr_<n> schema and nothing outside the task
// reaches it — so the fixture the in-process arm seeds for itself has to be
// asked for instead.
//
// THREE GATES, AND NONE OF THEM IS THE OTHER'S BACKSTOP.
//
//   the deploy    IS_NON_PROD_DEPLOY, which is an allowlist of 'preview' and
//                 'dev' rather than a negated prod check, so an absent or
//                 misspelt OTEL_SERVICE_ENVIRONMENT refuses. Prod cannot
//                 reach these routes at all.
//   the caller    the global SessionGuard, with no @PublicAccess() on
//                 anything here: the judge presents a real Clerk session
//                 token for its own user and gets 401 without one.
//   the rows      every row is written for, and removed as, the authenticated
//                 caller. There is no user id in a request body, so the judge
//                 cannot stage a fixture onto anybody else's account and
//                 cannot remove anything from one.
//
// Separate from TestFixturesController, whose class-level AdminOrM2MGuard is
// the wrong posture here: the judge user is neither an admin nor a machine,
// and making it one to run a sweep would buy it the whole admin surface. This
// is the same split TestFixturesVendorMocksController already makes for
// Playwright.
@Controller('test-fixtures/judge-chat-cases')
export class TestFixturesJudgeController {
  constructor(private readonly judgeFixture: JudgeChatFixtureService) {}

  @Post()
  @ResponseSchema(JudgeChatCaseResponseSchema)
  async setUpCase(
    @Body(new ZodValidationPipe(SetUpJudgeChatCaseSchema))
    body: SetUpJudgeChatCaseInput,
    @ReqUser() user: User,
  ) {
    this.assertNonProdDeploy()
    try {
      return await this.judgeFixture.setUp(user.id, body)
    } catch (err) {
      // The one refusal the request schema cannot make: whether a scope has a
      // row that carries the state asked for is the seeder's knowledge, and
      // it is still the caller's mistake rather than ours.
      if (err instanceof CaseListError) {
        throw new BadRequestException(err.message)
      }
      throw err
    }
  }

  @Delete(':organizationSlug')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(TearDownJudgeChatCaseResponseSchema)
  async tearDownCase(
    @Param('organizationSlug', new ZodValidationPipe(JudgeChatCaseSlugSchema))
    organizationSlug: string,
    @ReqUser() user: User,
  ) {
    this.assertNonProdDeploy()
    return {
      organizationSlug,
      removed: await this.judgeFixture.tearDown(user.id, organizationSlug),
    }
  }

  // Fail-closed to the known non-prod deploys, and 404 rather than 403 so the
  // controller doesn't advertise itself in prod — the posture the rest of
  // test-fixtures already takes.
  private assertNonProdDeploy() {
    if (!IS_NON_PROD_DEPLOY) {
      throw new NotFoundException()
    }
  }
}

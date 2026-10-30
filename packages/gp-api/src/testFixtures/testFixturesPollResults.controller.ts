import { NonProdDeployOnly } from './guards/NonProdDeploy.guard'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ReqElectedOffice } from '@/electedOffice/decorators/ReqElectedOffice.decorator'
import { UseElectedOffice } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { ElectedOffice, User } from '@/generated/prisma'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { IS_NON_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'
import { isTestUser } from '@/users/util/users.util'
import {
  type SeedPollResultsRequest,
  SeedPollResultsRequestSchema,
  SeedPollResultsResponseSchema,
} from '@goodparty_org/contracts'
import {
  Body,
  Controller,
  ForbiddenException,
  NotFoundException,
  Post,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { PollResultsSeedService } from './services/pollResultsSeed.service'

// Session-auth tier, like the vendor-mock routes: a Playwright spec calls it
// with the test user's own token. The office comes from the caller's
// x-organization-slug through UseElectedOffice, which checks ownership, so a
// caller can only seed into an office it holds.
@Controller('test-fixtures/polls')
@NonProdDeployOnly()
export class TestFixturesPollResultsController {
  constructor(private readonly pollResultsSeed: PollResultsSeedService) {}

  @Post('results')
  @UseElectedOffice()
  @ResponseSchema(SeedPollResultsResponseSchema)
  async seedPollResults(
    @Body(new ZodValidationPipe(SeedPollResultsRequestSchema))
    body: SeedPollResultsRequest,
    @ReqUser() user: User,
    @ReqElectedOffice() electedOffice: ElectedOffice,
  ) {
    if (!IS_NON_PROD_DEPLOY) {
      throw new NotFoundException()
    }
    if (!user.email || !isTestUser({ email: user.email })) {
      throw new ForbiddenException('Test users only')
    }
    return this.pollResultsSeed.seed(electedOffice.id, body)
  }
}

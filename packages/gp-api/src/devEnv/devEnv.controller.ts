import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { IS_NON_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'
import { DevEnvBundleResponseSchema } from '@goodparty_org/contracts'
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { DevEnvRequest } from './devEnv.types'
import { GithubOrgMemberGuard } from './guards/GithubOrgMember.guard'
import {
  GetDevEnvBundleInput,
  GetDevEnvBundleSchema,
} from './schemas/getBundle.schema'
import { DevEnvService } from './services/devEnv.service'

// Hands a contributor who has no gp-api account yet the per-package `.env`
// values for a local checkout, on the strength of their GitHub org
// membership alone. Deliberately not an @McpTool: this is a human bootstrap
// surface, not something an agent should be able to call.
//
// The response carries live dev credentials by contract — never log it.
@Controller('dev-env')
@PublicAccess()
@UseGuards(GithubOrgMemberGuard)
@UseInterceptors(ZodResponseInterceptor)
export class DevEnvController {
  constructor(private readonly devEnv: DevEnvService) {}

  @Post('bundle')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(DevEnvBundleResponseSchema)
  getBundle(
    @Req() req: DevEnvRequest,
    @Body(new ZodValidationPipe(GetDevEnvBundleSchema))
    body: GetDevEnvBundleInput,
  ) {
    // Fail-closed to the known non-prod deploys, and 404 rather than 403 so
    // the route does not advertise itself in prod (testFixtures' posture).
    // Local use requires OTEL_SERVICE_ENVIRONMENT=dev.
    if (!IS_NON_PROD_DEPLOY) {
      throw new NotFoundException()
    }
    return this.devEnv.getBundles(body.packages, req.githubLogin)
  }
}

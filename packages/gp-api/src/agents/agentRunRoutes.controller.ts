import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { isDevOnlyRouteEnabled } from '@/constituentFeedback/util/devOnlyRoute.util'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { type User } from '@/generated/prisma'
import { AgentRunRoutesService } from './agentRunRoutes.service'
import {
  AgentRunProgressResponseSchema,
  StartAgentRunRequestDto,
  StartAgentRunResponseSchema,
} from './agentRunRoutes.schema'

// One way to run any background agent over HTTP, on whichever engine will run
// it, so the Universal Judge reaches an agent through a base URL and nothing
// else. Dev and previews only: a judge run costs a real agent run, and its
// users are test users the product's own dispatch guards refuse.
@Controller('agents')
@UsePipes(ZodValidationPipe)
export class AgentRunRoutesController {
  constructor(private readonly runs: AgentRunRoutesService) {}

  @Post(':name/runs')
  @HttpCode(HttpStatus.CREATED)
  @ResponseSchema(StartAgentRunResponseSchema)
  start(
    @Param('name') name: string,
    @Body() body: StartAgentRunRequestDto,
    @ReqUser() user: User,
  ) {
    // 404, not 403: on prod the route should not admit it exists.
    if (!isDevOnlyRouteEnabled()) throw new NotFoundException()
    return this.runs.start(name, body.input, user)
  }

  @Get('runs/:runId')
  @ResponseSchema(AgentRunProgressResponseSchema)
  read(@Param('runId') runId: string, @ReqUser() user: User) {
    if (!isDevOnlyRouteEnabled()) throw new NotFoundException()
    return this.runs.read(runId, user)
  }
}

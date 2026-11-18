import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { M2MOnly } from '@/authentication/guards/M2MOnly.guard'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { PaginatedResponseSchema } from '@/shared/schemas/PaginatedResponse.schema'
import { AdminBackgroundAgentRunsService } from './services/adminBackgroundAgentRuns.service'
import {
  AdminBackgroundAgentRunsListQueryDto,
  BackgroundAgentRunDetailSchema,
  BackgroundAgentRunListItemSchema,
} from './schemas/adminBackgroundAgentRuns.schema'

// Read-only: the runs of gp-api's own background agents (`src/agents`). The
// PMF Engine's `ExperimentRun` page is `admin/agent-runs`, next door.
@Controller('admin/background-agent-runs')
@UsePipes(ZodValidationPipe)
export class AdminBackgroundAgentRunsController {
  constructor(
    private readonly backgroundAgentRuns: AdminBackgroundAgentRunsService,
  ) {}

  @Get()
  @UseGuards(M2MOnly)
  @ResponseSchema(PaginatedResponseSchema(BackgroundAgentRunListItemSchema))
  list(@Query() query: AdminBackgroundAgentRunsListQueryDto) {
    return this.backgroundAgentRuns.list(query)
  }

  @Get(':runId')
  @UseGuards(M2MOnly)
  @ResponseSchema(BackgroundAgentRunDetailSchema)
  detail(@Param('runId') runId: string) {
    return this.backgroundAgentRuns.detail(runId)
  }
}

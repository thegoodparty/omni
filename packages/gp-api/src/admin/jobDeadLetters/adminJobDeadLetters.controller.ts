import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { PaginatedResponseSchema } from '@/shared/schemas/PaginatedResponse.schema'
import { AdminJobDeadLettersService } from './services/adminJobDeadLetters.service'
import {
  AdminJobDeadLettersListQueryDto,
  JobDeadLetterSchema,
  RedriveJobDeadLetterResultSchema,
} from './schemas/adminJobDeadLetters.schema'

// Staff-only recovery for pg-boss dead letters (src/jobs/AGENTS.md § Dead
// letters). The ops script scripts/jobs-dead-letter.ts does the same work
// from a shell with DATABASE_URL; this is the console path, one job at a
// time, and it never redrives a batch.
@Controller('admin/job-dead-letters')
@UseGuards(AdminOrM2MGuard)
@UsePipes(ZodValidationPipe)
export class AdminJobDeadLettersController {
  constructor(private readonly deadLetters: AdminJobDeadLettersService) {}

  @Get()
  @ResponseSchema(PaginatedResponseSchema(JobDeadLetterSchema))
  list(@Query() query: AdminJobDeadLettersListQueryDto) {
    return this.deadLetters.list(query)
  }

  @Post(':id/redrive')
  @ResponseSchema(RedriveJobDeadLetterResultSchema)
  redrive(@Param('id', ParseUUIDPipe) id: string) {
    return this.deadLetters.redrive(id)
  }
}

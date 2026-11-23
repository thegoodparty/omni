import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  AdminJobDeadLettersBatchDto,
  AdminJobDeadLettersListQueryDto,
  DeleteJobDeadLetterResultSchema,
  DeleteJobDeadLettersResultSchema,
  JobDeadLetterQueuesSchema,
  JobDeadLetterSchema,
  RedriveJobDeadLetterResultSchema,
  RedriveJobDeadLettersResultSchema,
} from './schemas/adminJobDeadLetters.schema'

// Staff-only recovery for pg-boss dead letters (src/jobs/AGENTS.md § Dead
// letters). The ops script scripts/jobs-dead-letter.ts does the same work
// from a shell with DATABASE_URL; this is the console path. Every id is
// moved or dropped on its own, and the batch routes report the ones they
// could not handle instead of failing the whole request. The batch routes
// are declared before the `:id` ones so `batch` is never read as an id.
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

  @Get('queues')
  @ResponseSchema(JobDeadLetterQueuesSchema)
  queues() {
    return this.deadLetters.queues()
  }

  @Post('batch/redrive')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(RedriveJobDeadLettersResultSchema)
  redriveMany(@Body() body: AdminJobDeadLettersBatchDto) {
    return this.deadLetters.redriveMany(body.ids)
  }

  @Post('batch/delete')
  @HttpCode(HttpStatus.OK)
  @ResponseSchema(DeleteJobDeadLettersResultSchema)
  deleteMany(@Body() body: AdminJobDeadLettersBatchDto) {
    return this.deadLetters.deleteMany(body.ids)
  }

  @Get(':id')
  @ResponseSchema(JobDeadLetterSchema)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.deadLetters.get(id)
  }

  @Post(':id/redrive')
  @ResponseSchema(RedriveJobDeadLetterResultSchema)
  redrive(@Param('id', ParseUUIDPipe) id: string) {
    return this.deadLetters.redrive(id)
  }

  @Delete(':id')
  @ResponseSchema(DeleteJobDeadLetterResultSchema)
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.deadLetters.delete(id)
  }
}

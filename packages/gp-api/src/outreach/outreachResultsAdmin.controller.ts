import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  OutreachAwaitingResultsResponseSchema,
  OutreachResultsParseReportSchema,
  OutreachResultsTargetSchema,
  OutreachResultsUploadRequestSchema,
  type OutreachResultsUploadRequest,
} from '@goodparty_org/contracts'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { OutreachResultsAdminService } from './services/outreachResultsAdmin.service'

/**
 * The staff results surface (gp-admin via M2M): a work queue of sends
 * awaiting results and a per-send upload. This is what replaces the
 * `aws s3 cp` line fulfilment runs today for SMS.
 *
 * Static `admin/results` segments keep these clear of the social
 * controller's `:id` routes, and `queue` is declared before `:outreachId`
 * for the same reason the SMS console does it (find-my-way prefers static
 * matches, but the ordering is the thing a reader checks first).
 */
@Controller('outreach/admin/results')
@UseGuards(AdminOrM2MGuard)
export class OutreachResultsAdminController {
  constructor(private readonly resultsService: OutreachResultsAdminService) {}

  @Get('queue')
  @ResponseSchema(OutreachAwaitingResultsResponseSchema)
  queue() {
    return this.resultsService.listAwaiting()
  }

  @Get(':outreachId')
  @ResponseSchema(OutreachResultsTargetSchema)
  target(@Param('outreachId', ParseIntPipe) outreachId: number) {
    return this.resultsService.getTarget(outreachId)
  }

  // Both the dry run and the commit, told apart by `dryRun` in the body. One
  // route because they take the same file and differ only in whether the
  // rows are written — the page runs the first, shows the report, and then
  // runs the second with the same bytes.
  @Post(':outreachId')
  @ResponseSchema(OutreachResultsParseReportSchema)
  upload(
    @Param('outreachId', ParseIntPipe) outreachId: number,
    @Body(new ZodValidationPipe(OutreachResultsUploadRequestSchema))
    input: OutreachResultsUploadRequest,
  ) {
    return this.resultsService.upload(outreachId, input)
  }
}

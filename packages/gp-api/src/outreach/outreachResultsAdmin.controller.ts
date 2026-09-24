import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  ResultsInboxKindSchema,
  type ResultsInboxKind,
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
 * `aws s3 cp` line fulfilment used to run, for BOTH products.
 *
 * Static `admin/results` segments keep these clear of the social
 * controller's `:id` routes, and `queue` is declared before `:outreachId`
 * for the same reason the SMS console does it (find-my-way prefers static
 * matches, but the ordering is the thing a reader checks first).
 */
/**
 * A 400 rather than a 404 for an unknown kind: the id may well name
 * something real, it is the caller's routing that is wrong, and saying so
 * is what stops an operator hunting for a missing record.
 */
const parseKind = (raw: string): ResultsInboxKind => {
  const parsed = ResultsInboxKindSchema.safeParse(raw)
  if (!parsed.success) {
    throw new BadRequestException(
      `Unknown results kind "${raw}". Expected sms or poll.`,
    )
  }
  return parsed.data
}

@Controller('outreach/admin/results')
@UseGuards(AdminOrM2MGuard)
export class OutreachResultsAdminController {
  constructor(private readonly resultsService: OutreachResultsAdminService) {}

  @Get('queue')
  @ResponseSchema(OutreachAwaitingResultsResponseSchema)
  queue() {
    return this.resultsService.listAwaiting()
  }

  /**
   * Keyed on `<kind>/<id>` rather than a bare id, because the inbox now
   * carries two products whose id spaces neither overlap nor share a type:
   * a send is an integer Outreach key, a poll is a uuid. Sniffing the shape
   * would work until the day a poll id is all digits.
   *
   * It also removes the route-ordering hazard the single-segment version
   * had: `queue` is one segment and these are two, so they cannot collide
   * whatever order they are declared in.
   */
  @Get(':kind/:id')
  @ResponseSchema(OutreachResultsTargetSchema)
  target(@Param('kind') kind: string, @Param('id') id: string) {
    return this.resultsService.getTargetByKind(parseKind(kind), id)
  }

  // Both the dry run and the commit, told apart by `dryRun` in the body. One
  // route because they take the same file and differ only in whether the
  // rows are written — the page runs the first, shows the report, and then
  // runs the second with the same bytes.
  //
  // One route for both products too: the operator uploads the same way
  // whichever it is, and the service decides whether that means ingesting
  // the rows or forwarding the file to the analysis pipeline.
  @Post(':kind/:id')
  @ResponseSchema(OutreachResultsParseReportSchema)
  upload(
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(OutreachResultsUploadRequestSchema))
    input: OutreachResultsUploadRequest,
  ) {
    return this.resultsService.uploadByKind(parseKind(kind), id, input)
  }
}

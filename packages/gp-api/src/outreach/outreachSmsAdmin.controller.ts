import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  ApproveSmsOutreachRequestSchema,
  CancelSmsOutreachRequestSchema,
  DenySmsOutreachRequestSchema,
  EditSmsOutreachDateRequestSchema,
  EditSmsOutreachRequestSchema,
  LinkSmsOutreachJobRequestSchema,
  ReplaceSmsOutreachJobRequestSchema,
  SmsAdminDetailResponseSchema,
  SmsApprovalQueueItemSchema,
  SmsApprovalQueueResponseSchema,
  SmsReplyBackfillRequestSchema,
  SmsReplyBackfillResponseSchema,
  SmsTestMessageRequestSchema,
  SmsTestMessageResponseSchema,
  SmsVendorBalanceResponseSchema,
  type ApproveSmsOutreachRequest,
  type CancelSmsOutreachRequest,
  type DenySmsOutreachRequest,
  type EditSmsOutreachDateRequest,
  type EditSmsOutreachRequest,
  type LinkSmsOutreachJobRequest,
  type ReplaceSmsOutreachJobRequest,
  type SmsReplyBackfillRequest,
  type SmsTestMessageRequest,
} from '@goodparty_org/contracts'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { JobsService } from '@/jobs/jobs.service'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { OutreachSmsAdminService } from './services/outreachSmsAdmin.service'

// The CAS SMS console (gp-admin via M2M): the approval queue is the one
// human gate between a scheduled campaign and Peerly's canvassers. Static
// `admin/sms` segments keep these clear of the social controller's `:id`
// routes (find-my-way prefers static matches).
@Controller('outreach/admin/sms')
@UseGuards(AdminOrM2MGuard)
export class OutreachSmsAdminController {
  constructor(
    private readonly adminService: OutreachSmsAdminService,
    private readonly jobs: JobsService,
  ) {}

  @Get('queue')
  @ResponseSchema(SmsApprovalQueueResponseSchema)
  async queue() {
    return { items: await this.adminService.listQueue() }
  }

  // Static segment, so it never collides with `:id` (ParseIntPipe would
  // 400 'balance' anyway, but find-my-way matches static first).
  @Get('balance')
  @ResponseSchema(SmsVendorBalanceResponseSchema)
  async balance() {
    return { account: await this.adminService.getVendorBalance() }
  }

  // Win text replies from Peerly's reports run in a background job (it takes
  // minutes to hours); the result is its log summary.
  @Post('backfill-replies')
  @HttpCode(HttpStatus.ACCEPTED)
  @ResponseSchema(SmsReplyBackfillResponseSchema)
  async backfillReplies(
    @Body(new ZodValidationPipe(SmsReplyBackfillRequestSchema))
    { dryRun }: SmsReplyBackfillRequest,
  ) {
    return { jobId: await this.jobs.send('winReplyBackfill', { dryRun }) }
  }

  @Get(':id')
  @ResponseSchema(SmsAdminDetailResponseSchema)
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.getDetail(id)
  }

  @Post(':id/approve')
  @ResponseSchema(SmsApprovalQueueItemSchema)
  approve(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(ApproveSmsOutreachRequestSchema))
    input: ApproveSmsOutreachRequest,
  ) {
    return this.adminService.approve(id, input)
  }

  @Post(':id/deny')
  @ResponseSchema(SmsApprovalQueueItemSchema)
  deny(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(DenySmsOutreachRequestSchema))
    input: DenySmsOutreachRequest,
  ) {
    return this.adminService.deny(id, input)
  }

  @Post(':id/cancel')
  @ResponseSchema(SmsApprovalQueueItemSchema)
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(CancelSmsOutreachRequestSchema))
    input: CancelSmsOutreachRequest,
  ) {
    return this.adminService.cancel(id, input)
  }

  @Patch(':id/date')
  @ResponseSchema(SmsApprovalQueueItemSchema)
  editDate(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(EditSmsOutreachDateRequestSchema))
    input: EditSmsOutreachDateRequest,
  ) {
    return this.adminService.editDate(id, input)
  }

  @Post(':id/replace-job')
  @ResponseSchema(SmsApprovalQueueItemSchema)
  replaceJob(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(ReplaceSmsOutreachJobRequestSchema))
    input: ReplaceSmsOutreachJobRequest,
  ) {
    return this.adminService.replaceJob(id, input)
  }

  @Post(':id/link-job')
  @ResponseSchema(SmsApprovalQueueItemSchema)
  linkJob(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(LinkSmsOutreachJobRequestSchema))
    input: LinkSmsOutreachJobRequest,
  ) {
    return this.adminService.linkReplacementJob(id, input)
  }

  @Post(':id/test')
  @ResponseSchema(SmsTestMessageResponseSchema)
  sendTest(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(SmsTestMessageRequestSchema))
    input: SmsTestMessageRequest,
  ) {
    return this.adminService.sendTestMessage(id, input)
  }

  @Patch(':id')
  @ResponseSchema(SmsApprovalQueueItemSchema)
  edit(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(EditSmsOutreachRequestSchema))
    input: EditSmsOutreachRequest,
  ) {
    return this.adminService.editScript(id, input)
  }
}

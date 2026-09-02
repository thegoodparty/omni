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
  ApproveSmsOutreachRequestSchema,
  DenySmsOutreachRequestSchema,
  SmsAdminDetailResponseSchema,
  SmsApprovalQueueItemSchema,
  SmsApprovalQueueResponseSchema,
  type ApproveSmsOutreachRequest,
  type DenySmsOutreachRequest,
} from '@goodparty_org/contracts'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { OutreachSmsAdminService } from './services/outreachSmsAdmin.service'

// The CAS SMS console (gp-admin via M2M): the approval queue is the one
// human gate between a scheduled campaign and Peerly's canvassers. Static
// `admin/sms` segments keep these clear of the social controller's `:id`
// routes (find-my-way prefers static matches).
@Controller('outreach/admin/sms')
@UseGuards(AdminOrM2MGuard)
export class OutreachSmsAdminController {
  constructor(private readonly adminService: OutreachSmsAdminService) {}

  @Get('queue')
  @ResponseSchema(SmsApprovalQueueResponseSchema)
  async queue() {
    return { items: await this.adminService.listQueue() }
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
}

import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  ApprovePollRequestSchema,
  DenyPollRequestSchema,
  EditPollRequestSchema,
  PollQueueItemSchema,
  PollQueueQuerySchema,
  PollQueueResponseSchema,
  PollReviewDetailSchema,
  type ApprovePollRequest,
  type DenyPollRequest,
  type EditPollRequest,
  type PollQueueQuery,
} from '@goodparty_org/contracts'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { OutreachPollAdminService } from './services/outreachPollAdmin.service'

// The staff poll review queue (gp-admin via M2M). A paid poll sends nothing
// until it is approved here.
@Controller('outreach/admin/polls')
@UseGuards(AdminOrM2MGuard)
@UseInterceptors(ZodResponseInterceptor)
export class OutreachPollAdminController {
  constructor(private readonly adminService: OutreachPollAdminService) {}

  @Get('queue')
  @ResponseSchema(PollQueueResponseSchema)
  async queue(
    @Query(new ZodValidationPipe(PollQueueQuerySchema))
    query: PollQueueQuery,
  ) {
    return { items: await this.adminService.listQueue(query.status) }
  }

  @Get(':id')
  @ResponseSchema(PollReviewDetailSchema)
  detail(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.getDetail(id)
  }

  @Post(':id/approve')
  @ResponseSchema(PollQueueItemSchema)
  approve(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(ApprovePollRequestSchema))
    input: ApprovePollRequest,
  ) {
    return this.adminService.approve(id, input)
  }

  @Post(':id/deny')
  @ResponseSchema(PollQueueItemSchema)
  deny(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(DenyPollRequestSchema))
    input: DenyPollRequest,
  ) {
    return this.adminService.deny(id, input)
  }

  @Patch(':id')
  @ResponseSchema(PollReviewDetailSchema)
  edit(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(EditPollRequestSchema))
    input: EditPollRequest,
  ) {
    return this.adminService.edit(id, input)
  }
}

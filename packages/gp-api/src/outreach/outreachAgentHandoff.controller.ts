import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import {
  AgentHandoffClaimResponse,
  AgentHandoffClaimResponseSchema,
  AgentHandoffListResponse,
  AgentHandoffListResponseSchema,
  AgentHandoffReport,
  AgentHandoffReportResponse,
  AgentHandoffReportResponseSchema,
  AgentHandoffReportSchema,
  OutreachResultsParseReport,
  OutreachResultsParseReportSchema,
  OutreachResultsUploadRequest,
  OutreachResultsUploadRequestSchema,
} from '@goodparty_org/contracts'
import { HandoffAgentGuard } from '@/authentication/guards/HandoffAgent.guard'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import { ZodResponseInterceptor } from '@/shared/interceptors/ZodResponse.interceptor'
import { OutreachTextHandoffService } from './services/outreachTextHandoff.service'

// The Delegate swarm's work queue for Scale to Win. The controller path is
// the hand-off tier boundary (isHandoffRoute); keep it under the prefix.
@Controller('outreach/agent/handoffs')
@UseGuards(HandoffAgentGuard)
@UseInterceptors(ZodResponseInterceptor)
export class OutreachAgentHandoffController {
  constructor(private readonly handoffs: OutreachTextHandoffService) {}

  @Get()
  @ResponseSchema(AgentHandoffListResponseSchema)
  async list(): Promise<AgentHandoffListResponse> {
    return { items: await this.handoffs.listDue(new Date()) }
  }

  @Post(':outreachId/claim')
  @HttpCode(200)
  @ResponseSchema(AgentHandoffClaimResponseSchema)
  claim(
    @Param('outreachId', ParseIntPipe) outreachId: number,
  ): Promise<AgentHandoffClaimResponse> {
    return this.handoffs.claim(outreachId, new Date())
  }

  @Post(':outreachId/report')
  @HttpCode(200)
  @ResponseSchema(AgentHandoffReportResponseSchema)
  report(
    @Param('outreachId', ParseIntPipe) outreachId: number,
    @Body(new ZodValidationPipe(AgentHandoffReportSchema))
    body: AgentHandoffReport,
  ): Promise<AgentHandoffReportResponse> {
    return this.handoffs.report(outreachId, body, new Date())
  }

  // The swarm's own door to the results ingest, so it never holds an
  // AdminOrM2M token. Only a scheduled agent hand-off takes replies.
  @Post(':outreachId/replies')
  @HttpCode(200)
  @ResponseSchema(OutreachResultsParseReportSchema)
  replies(
    @Param('outreachId', ParseIntPipe) outreachId: number,
    @Body(new ZodValidationPipe(OutreachResultsUploadRequestSchema))
    body: OutreachResultsUploadRequest,
  ): Promise<OutreachResultsParseReport> {
    return this.handoffs.submitReplies(outreachId, body, new Date())
  }
}

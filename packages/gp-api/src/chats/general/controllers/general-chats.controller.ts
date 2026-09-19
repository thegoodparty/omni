import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotImplementedException,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common'
import { Organization, User } from '../../../generated/prisma'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { PinoLogger } from 'nestjs-pino'
import { ZodValidationPipe } from 'nestjs-zod'
import type {
  ChatAttachmentDownloadResponse,
  ChatAttachmentListResponse,
  ChatConversation as ChatConversationResponse,
  ChatHistoryResponse,
  ChatMessageFeedback as ChatMessageFeedbackResponse,
  CreateChatResponse,
  PresignResponse,
} from '@goodparty_org/contracts'
import {
  ChatAttachmentDownloadResponseSchema,
  ChatAttachmentListResponseSchema,
  ChatAttachmentSchema,
  FinalizeRequest,
  FinalizeRequestSchema,
  PresignRequest,
  PresignRequestSchema,
  PresignResponseSchema,
} from '@goodparty_org/contracts'
import { z } from 'zod'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import type { ChatStreamChunk } from '@/chats/services/chatStream.service'
import { waitForDrain } from '@/chats/services/streamDrain.util'
import {
  ChatAttachmentsService,
  SERVE_CHAT_ATTACHMENTS_FLAG,
} from '@/chats/services/chatAttachments.service'
import { FeaturesService } from '@/features/services/features.service'
import { GeneralChatsService } from '../services/general-chats.service'
import {
  ChatConversationSchema,
  ChatHistoryQueryDto,
  ChatHistoryResponseSchema,
  ChatMessageFeedbackSchema,
  CreateChatDto,
  CreateChatResponseSchema,
  SendChatMessageDto,
  SetChatMessageFeedbackDto,
} from '../schemas/GeneralChat.schema'

type ChatAttachmentDTO = z.infer<typeof ChatAttachmentSchema>

const SSE_HEADERS: Record<string, string> = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
}

const STREAM_TIMEOUT_MS = 300_000

// After this long backpressured on a single write with no drain, treat the
// client as stalled and stop awaiting drain (write through the rest). Bounds a
// connected-but-non-draining client so it can't wedge the stream for the full
// STREAM_TIMEOUT_MS.
const DRAIN_STALL_TIMEOUT_MS = 15_000

const TIMEOUT_ERROR_CHUNK = `data: ${JSON.stringify({
  type: 'error',
  code: 'aborted',
  message: 'Response took too long. Please try again.',
  retryable: true,
})}\n\n`

const INTERNAL_ERROR_CHUNK = `data: ${JSON.stringify({
  type: 'error',
  code: 'internal',
  message: 'Chat stream failed.',
  retryable: true,
})}\n\n`

const sanitizeChunk = (chunk: ChatStreamChunk): ChatStreamChunk => {
  if (chunk.type === 'done' && !chunk.assistantMessageId) {
    return { type: 'done' }
  }
  return chunk
}

const formatChunk = (chunk: ChatStreamChunk): string =>
  `data: ${JSON.stringify(sanitizeChunk(chunk))}\n\n`

@Controller('chats')
@UseOrganization()
export class GeneralChatsController {
  constructor(
    private readonly chats: GeneralChatsService,
    private readonly features: FeaturesService,
    private readonly attachments: ChatAttachmentsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(GeneralChatsController.name)
  }

  @Post()
  @ResponseSchema(CreateChatResponseSchema)
  async createChat(
    @ReqUser() user: User,
    @ReqOrganization() { slug: organizationSlug }: Organization,
    @Body(ZodValidationPipe) body: CreateChatDto,
  ): Promise<CreateChatResponse> {
    return this.chats.resolveConversation(
      {
        scope: body.scope,
        organizationSlug,
        anchor: body.anchor,
      },
      user.id,
    )
  }

  @Get()
  @ResponseSchema(ChatHistoryResponseSchema)
  async listChats(
    @ReqUser() user: User,
    @ReqOrganization() { slug: organizationSlug }: Organization,
    @Query(ZodValidationPipe) query: ChatHistoryQueryDto,
  ): Promise<ChatHistoryResponse> {
    const conversations = await this.chats.listConversations({
      scope: query.scope,
      userId: user.id,
      organizationSlug,
    })
    return { conversations }
  }

  @Post(':conversationId/messages') async streamMessage(
    @ReqUser() user: User,
    @ReqOrganization() { slug: organizationSlug }: Organization,
    @Param('conversationId') conversationId: string,
    @Query(ZodValidationPipe) query: ChatHistoryQueryDto,
    @Body(ZodValidationPipe) body: SendChatMessageDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    await this.chats.assertConversationAccessible(
      conversationId,
      query.scope,
      user.id,
      organizationSlug,
    )

    const abortController = new AbortController()
    const onClose = () => abortController.abort()
    req.raw.once('close', onClose)
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      abortController.abort()
    }, STREAM_TIMEOUT_MS)

    reply.raw.writeHead(HttpStatus.OK, SSE_HEADERS)

    const iterable = this.chats.sendMessage({
      conversationId,
      scope: query.scope,
      userId: user.id,
      organizationSlug,
      userMessage: body.content,
      signal: abortController.signal,
      ...(body.clientMessageId && { clientMessageId: body.clientMessageId }),
    })

    let errored = false
    let stalled = false
    try {
      for await (const chunk of iterable) {
        if (abortController.signal.aborted) break
        const flushed: boolean = reply.raw.write(formatChunk(chunk))
        if (!flushed && !stalled) {
          const outcome = await waitForDrain(
            reply.raw,
            abortController.signal,
            DRAIN_STALL_TIMEOUT_MS,
          )
          if (outcome === 'stalled') stalled = true
        }
      }
    } catch (err) {
      errored = true
      this.logger.error(
        { err, conversationId, userId: user.id },
        'general chat SSE stream failed',
      )
    } finally {
      clearTimeout(timeout)
      req.raw.off('close', onClose)
      if (timedOut) {
        try {
          reply.raw.write(TIMEOUT_ERROR_CHUNK)
        } catch (err) {
          this.logger.warn(
            { err, conversationId },
            'failed to write timeout chunk to SSE stream',
          )
        }
      } else if (errored) {
        try {
          reply.raw.write(INTERNAL_ERROR_CHUNK)
        } catch (err) {
          this.logger.warn(
            { err, conversationId },
            'failed to write error chunk to SSE stream',
          )
        }
      }
      reply.raw.end()
    }
  }

  @Get(':conversationId')
  @ResponseSchema(ChatConversationSchema)
  async getConversation(
    @ReqUser() user: User,
    @ReqOrganization() { slug: organizationSlug }: Organization,
    @Param('conversationId') conversationId: string,
    @Query(ZodValidationPipe) query: ChatHistoryQueryDto,
  ): Promise<ChatConversationResponse> {
    const { scope, title, messages, feedbackByMessageId } =
      await this.chats.loadConversation(
        conversationId,
        query.scope,
        user.id,
        organizationSlug,
      )
    return {
      conversationId,
      scope,
      title,
      messages: messages.map((m) => {
        const rating = feedbackByMessageId.get(m.id)
        return {
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
          ...(m.segments.length > 0 && {
            segments: m.segments.map((s) => ({
              kind: s.kind,
              text: s.text,
              toolName: s.toolName,
              ...(s.payload != null && { payload: s.payload }),
            })),
          }),
          ...(rating && {
            feedback: {
              feedback: rating.feedback,
              comment: rating.comment,
            },
          }),
        }
      }),
    }
  }

  @Put(':conversationId/messages/:messageId/feedback')
  @ResponseSchema(ChatMessageFeedbackSchema)
  async setMessageFeedback(
    @ReqUser() user: User,
    @ReqOrganization() { slug: organizationSlug }: Organization,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Query(ZodValidationPipe) query: ChatHistoryQueryDto,
    @Body(ZodValidationPipe) body: SetChatMessageFeedbackDto,
  ): Promise<ChatMessageFeedbackResponse> {
    return this.chats.setMessageFeedback({
      conversationId,
      messageId,
      scope: query.scope,
      userId: user.id,
      organizationSlug,
      feedback: body.feedback,
      comment: body.comment,
    })
  }

  @Delete(':conversationId/messages/:messageId/feedback')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearMessageFeedback(
    @ReqUser() user: User,
    @ReqOrganization() { slug: organizationSlug }: Organization,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Query(ZodValidationPipe) query: ChatHistoryQueryDto,
  ): Promise<void> {
    await this.chats.clearMessageFeedback({
      conversationId,
      messageId,
      scope: query.scope,
      userId: user.id,
      organizationSlug,
    })
  }

  @Post(':conversationId/attachments/presign')
  @ResponseSchema(PresignResponseSchema)
  async presignAttachment(
    @ReqUser() user: User,
    @ReqOrganization() { slug: organizationSlug }: Organization,
    @Param('conversationId') conversationId: string,
    @Body(new ZodValidationPipe(PresignRequestSchema)) body: PresignRequest,
  ): Promise<PresignResponse> {
    const enabled = await this.features.isFeatureEnabled({
      user,
      feature: SERVE_CHAT_ATTACHMENTS_FLAG,
    })
    if (!enabled) throw new NotFoundException()
    return this.attachments.presign(
      conversationId,
      user.id,
      organizationSlug,
      body,
    )
  }

  @Post(':conversationId/attachments')
  @ResponseSchema(ChatAttachmentSchema)
  async finalizeAttachment(
    @ReqUser() user: User,
    @ReqOrganization() { slug: organizationSlug }: Organization,
    @Param('conversationId') conversationId: string,
    @Body(new ZodValidationPipe(FinalizeRequestSchema)) body: FinalizeRequest,
  ): Promise<ChatAttachmentDTO> {
    const enabled = await this.features.isFeatureEnabled({
      user,
      feature: SERVE_CHAT_ATTACHMENTS_FLAG,
    })
    if (!enabled) throw new NotFoundException()
    return this.attachments.finalize(
      conversationId,
      user.id,
      organizationSlug,
      body,
    )
  }

  @Post(':conversationId/attachments/link')
  async linkAttachment(@ReqUser() user: User): Promise<void> {
    const enabled = await this.features.isFeatureEnabled({
      user,
      feature: SERVE_CHAT_ATTACHMENTS_FLAG,
    })
    if (!enabled) throw new NotFoundException()
    throw new NotImplementedException()
  }

  @Get(':conversationId/attachments')
  @ResponseSchema(ChatAttachmentListResponseSchema)
  async listAttachments(
    @ReqUser() user: User,
    @ReqOrganization() { slug: organizationSlug }: Organization,
    @Param('conversationId') conversationId: string,
  ): Promise<ChatAttachmentListResponse> {
    return this.attachments.listAttachments(
      conversationId,
      user.id,
      organizationSlug,
    )
  }

  @Get(':conversationId/attachments/:attachmentId/download')
  @ResponseSchema(ChatAttachmentDownloadResponseSchema)
  async downloadAttachment(
    @ReqUser() user: User,
    @ReqOrganization() { slug: organizationSlug }: Organization,
    @Param('conversationId') conversationId: string,
    @Param('attachmentId') attachmentId: string,
  ): Promise<ChatAttachmentDownloadResponse> {
    return this.attachments.getDownloadUrl(
      conversationId,
      attachmentId,
      user.id,
      organizationSlug,
    )
  }

  @Delete(':conversationId/attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAttachment(
    @ReqUser() user: User,
    @ReqOrganization() { slug: organizationSlug }: Organization,
    @Param('conversationId') conversationId: string,
    @Param('attachmentId') attachmentId: string,
  ): Promise<void> {
    await this.attachments.deleteAttachment(
      conversationId,
      attachmentId,
      user.id,
      organizationSlug,
    )
  }

  @Delete(':conversationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConversation(
    @ReqUser() user: User,
    @ReqOrganization() { slug: organizationSlug }: Organization,
    @Param('conversationId') conversationId: string,
    @Query(ZodValidationPipe) query: ChatHistoryQueryDto,
  ): Promise<void> {
    await this.chats.deleteConversation(
      conversationId,
      query.scope,
      user.id,
      organizationSlug,
    )
  }
}

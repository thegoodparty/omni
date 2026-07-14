import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common'
import { User } from '../../../generated/prisma'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { PinoLogger } from 'nestjs-pino'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import type { ChatStreamChunk } from '@/chats/services/chatStream.service'
import { waitForDrain } from '@/chats/services/streamDrain.util'
import { BriefingChatCreateService } from '../services/briefingChatCreate.service'
import { BriefingChatsService } from '../services/briefing-chats.service'
import {
  CreateBriefingChatResponse,
  CreateBriefingChatSchema,
  createBriefingChatResponseSchema,
} from '../schemas/CreateBriefingChat.schema'
import {
  GetConversationResponse,
  getConversationSchema,
} from '../schemas/GetConversation.schema'
import { SendMessageSchema } from '../schemas/SendMessage.schema'

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

@Controller('briefing-chats')
export class BriefingChatsController {
  constructor(
    private readonly chats: BriefingChatsService,
    private readonly chatCreate: BriefingChatCreateService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(BriefingChatsController.name)
  }

  @Post()
  @ResponseSchema(createBriefingChatResponseSchema)
  async createChat(
    @ReqUser() user: User,
    @Body(ZodValidationPipe) body: CreateBriefingChatSchema,
  ): Promise<CreateBriefingChatResponse> {
    return this.chatCreate.findOrCreate({
      userId: user.id,
      meetingDate: body.meetingDate,
      anchor: body.anchor,
    })
  }

  @Post(':annotationId/messages')
  async streamMessage(
    @ReqUser() user: User,
    @Param('annotationId') annotationId: string,
    @Body(ZodValidationPipe) body: SendMessageSchema,
    @Req() req: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
  ): Promise<void> {
    await this.chats.assertBriefingChatAccessible(annotationId, user.id)

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
      annotationId,
      userId: user.id,
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
        { err, annotationId, userId: user.id },
        'briefing chat SSE stream failed',
      )
    } finally {
      clearTimeout(timeout)
      req.raw.off('close', onClose)
      if (timedOut) {
        try {
          reply.raw.write(TIMEOUT_ERROR_CHUNK)
        } catch (err) {
          this.logger.warn(
            { err, annotationId },
            'failed to write timeout chunk to SSE stream',
          )
        }
      } else if (errored) {
        try {
          reply.raw.write(INTERNAL_ERROR_CHUNK)
        } catch (err) {
          this.logger.warn(
            { err, annotationId },
            'failed to write error chunk to SSE stream',
          )
        }
      }
      reply.raw.end()
    }
  }

  @Get(':annotationId')
  @ResponseSchema(getConversationSchema)
  async getConversation(
    @ReqUser() user: User,
    @Param('annotationId') annotationId: string,
  ): Promise<GetConversationResponse> {
    const { conversationId, messages } = await this.chats.loadConversation(
      annotationId,
      user.id,
    )
    return {
      conversationId,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    }
  }

  @Delete(':annotationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConversation(
    @ReqUser() user: User,
    @Param('annotationId') annotationId: string,
  ): Promise<void> {
    await this.chats.deleteConversation(annotationId, user.id)
  }
}

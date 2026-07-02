import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common'
import { Organization, User } from '../../../generated/prisma'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { PinoLogger } from 'nestjs-pino'
import { ZodValidationPipe } from 'nestjs-zod'
import type {
  ChatConversation as ChatConversationResponse,
  ChatHistoryResponse,
  CreateChatResponse,
} from '@goodparty_org/contracts'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { UseOrganization } from '@/organizations/decorators/UseOrganization.decorator'
import { ReqOrganization } from '@/organizations/decorators/ReqOrganization.decorator'
import { ResponseSchema } from '@/shared/decorators/ResponseSchema.decorator'
import type { ChatStreamChunk } from '@/chats/services/chatStream.service'
import { GeneralChatsService } from '../services/general-chats.service'
import {
  ChatConversationSchema,
  ChatHistoryQueryDto,
  ChatHistoryResponseSchema,
  CreateChatDto,
  CreateChatResponseSchema,
  SendChatMessageDto,
} from '../schemas/GeneralChat.schema'

const SSE_HEADERS: Record<string, string> = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
}

const STREAM_TIMEOUT_MS = 300_000

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

interface DrainableStream {
  once?: (event: string, cb: () => void) => void
  off?: (event: string, cb: () => void) => void
}

const waitForDrain = (
  stream: DrainableStream,
  signal: AbortSignal,
): Promise<void> =>
  new Promise<void>((resolve) => {
    if (typeof stream.once !== 'function') {
      resolve()
      return
    }
    const cleanup = () => {
      stream.off?.('drain', onDrain)
      stream.off?.('close', onTerminal)
      stream.off?.('error', onTerminal)
      signal.removeEventListener('abort', onTerminal)
    }
    const onDrain = () => {
      cleanup()
      resolve()
    }
    const onTerminal = () => {
      cleanup()
      resolve()
    }
    stream.once('drain', onDrain)
    stream.once('close', onTerminal)
    stream.once('error', onTerminal)
    if (signal.aborted) {
      onTerminal()
      return
    }
    signal.addEventListener('abort', onTerminal, { once: true })
  })

@Controller('chats')
@UseOrganization()
export class GeneralChatsController {
  constructor(
    private readonly chats: GeneralChatsService,
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
    try {
      for await (const chunk of iterable) {
        if (abortController.signal.aborted) break
        const flushed: boolean = reply.raw.write(formatChunk(chunk))
        if (!flushed) {
          await waitForDrain(reply.raw, abortController.signal)
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
    const { scope, title, messages } = await this.chats.loadConversation(
      conversationId,
      query.scope,
      user.id,
      organizationSlug,
    )
    return {
      conversationId,
      scope,
      title,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        ...(m.segments.length > 0 && {
          segments: m.segments.map((s) => ({
            kind: s.kind,
            text: s.text,
            toolName: s.toolName,
          })),
        }),
      })),
    }
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

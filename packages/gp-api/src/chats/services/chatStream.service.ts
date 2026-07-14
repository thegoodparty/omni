import { Injectable, Optional } from '@nestjs/common'
import {
  ChatMessage,
  ChatMessageRole,
  ChatMessageSegmentKind,
  Prisma,
} from '../../generated/prisma'
import { PinoLogger } from 'nestjs-pino'
import { type LlmMessage } from '@/llm/types/llmMessages.types'
import {
  LlmService,
  LlmStreamResult,
  LlmTool,
} from '@/llm/services/llm.service'
import { BraintrustService } from 'src/vendors/braintrust/braintrust.service'
import { ChatStoreService, PersistedSegment } from './chatStore.prisma'

export type ChatStreamErrorCode =
  | 'conversation_not_found'
  | 'upstream_unavailable'
  | 'rate_limited'
  | 'aborted'
  | 'internal'

export type ChatStreamChunk =
  | { type: 'text'; delta: string }
  // The model has begun writing a tool call's arguments (before tool_call).
  // Transient signal for a per-tool "generating" indicator; not persisted.
  | { type: 'tool_input_start'; toolName: string }
  | { type: 'tool_call'; toolName: string; args: unknown }
  | { type: 'tool_result'; toolName: string; result: unknown }
  | { type: 'done'; assistantMessageId?: string }
  | {
      type: 'error'
      code: ChatStreamErrorCode
      message: string
      retryable: boolean
    }

export interface StreamArgs {
  conversationId: string
  ownerUserId: number
  systemPrompt: string
  tools: Record<string, LlmTool>
  userMessage: string
  signal?: AbortSignal
  clientMessageId?: string
  models?: string[]
  maxSteps?: number
}

export const MAX_CHAT_HISTORY_MESSAGES = 40
export const MAX_BUFFERED_CHUNKS = 256

// Sentinel persisted as the assistant message body when a stream is
// aborted before any text was produced (e.g. user navigated away during
// tool-calling). The client matches this exact string to render a Retry
// affordance instead of the marker text.
export const CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER =
  '__chat:interrupted_before_output__'

const GENERIC_MESSAGES: Record<ChatStreamErrorCode, string> = {
  conversation_not_found: 'Conversation not found.',
  upstream_unavailable: 'Chat service is temporarily unavailable.',
  rate_limited: 'Rate limit reached. Please wait and try again.',
  aborted: 'Chat stream aborted.',
  internal: 'Chat stream failed. Please try again.',
}

const RETRYABLE: Record<ChatStreamErrorCode, boolean> = {
  conversation_not_found: false,
  upstream_unavailable: true,
  rate_limited: true,
  aborted: false,
  internal: false,
}

// Tool args arrive typed as `unknown` from the AI SDK, but they are JSON by
// construction (the model produced them against the tool's JSON schema), so
// persisting them as the segment payload is safe.
const toJsonPayload = (value: unknown): Prisma.InputJsonValue | null => {
  if (value === null || value === undefined) return null

  return value as Prisma.InputJsonValue
}

const isAbortError = (err: unknown, signal?: AbortSignal): boolean => {
  if (signal?.aborted) return true
  if (err instanceof Error && err.name === 'AbortError') return true
  return false
}

const getStatusCode = (err: unknown): number | undefined => {
  if (err && typeof err === 'object') {
    const candidate = (err as { status?: number; statusCode?: number }).status
    if (typeof candidate === 'number') return candidate
    const alt = (err as { statusCode?: number }).statusCode
    if (typeof alt === 'number') return alt
  }
  return undefined
}

const classifyError = (
  err: unknown,
  signal?: AbortSignal,
): ChatStreamErrorCode => {
  if (isAbortError(err, signal)) return 'aborted'
  const status = getStatusCode(err)
  const text = err instanceof Error ? err.message : String(err)
  if (status === 429 || /\b429\b|rate.?limit/i.test(text)) {
    return 'rate_limited'
  }
  if (
    (status !== undefined && status >= 500 && status < 600) ||
    /\b5\d\d\b/.test(text) ||
    /network|ECONN|ETIMEDOUT|fetch failed/i.test(text)
  ) {
    return 'upstream_unavailable'
  }
  return 'internal'
}

const buildErrorChunk = (code: ChatStreamErrorCode): ChatStreamChunk => ({
  type: 'error',
  code,
  message: GENERIC_MESSAGES[code],
  retryable: RETRYABLE[code],
})

const roleToOpenAiRole = (
  role: ChatMessageRole,
): 'user' | 'assistant' | 'system' | 'tool' => role

const toLlmMessages = (
  systemPrompt: string,
  history: ChatMessage[],
): LlmMessage[] => {
  // A scope may seed an assistant greeting as the conversation's first message
  // (Campaign Manager) so it persists and replays. Anthropic requires the
  // message list to open with a user turn, so fold a leading assistant message
  // into the system prompt instead of sending it as an invalid leading turn.
  // (Also covers the rare case where history truncation starts on an assistant
  // reply.)
  const [first, ...tail] = history
  const leadingGreeting =
    first?.role === ChatMessageRole.assistant ? first : null
  const system = leadingGreeting
    ? `${systemPrompt}\n\nYou already greeted the candidate with:\n${leadingGreeting.content}`
    : systemPrompt
  const rest = leadingGreeting ? tail : history

  const out: LlmMessage[] = [{ role: 'system', content: system }]
  for (const m of rest) {
    const role = roleToOpenAiRole(m.role)
    if (role === 'system') {
      out.push({ role: 'system', content: m.content })
      continue
    }
    if (role === 'user') {
      out.push({ role: 'user', content: m.content })
      continue
    }
    if (role === 'assistant') {
      // A widget-only turn persists with empty content (its tool segments
      // aren't replayed to the model). Sending `{content: ''}` makes Anthropic
      // reject the turn ("text content blocks must be non-empty"), so drop
      // empty-content assistant turns from the replayed history.
      if (m.content.length === 0) continue
      out.push({ role: 'assistant', content: m.content })
      continue
    }
  }
  return out
}

interface BufferedChunk {
  chunk: ChatStreamChunk
}

class ChunkQueue {
  private buffer: BufferedChunk[] = []
  private resolvers: Array<(value: BufferedChunk | null) => void> = []
  private drainWaiters: Array<() => void> = []
  private closed = false
  private readonly maxSize: number
  private readonly signal?: AbortSignal
  private readonly onAbort?: () => void

  constructor(maxSize = MAX_BUFFERED_CHUNKS, signal?: AbortSignal) {
    this.maxSize = maxSize
    if (signal) {
      this.signal = signal
      this.onAbort = () => this.close()
      if (signal.aborted) {
        this.closed = true
      } else {
        signal.addEventListener('abort', this.onAbort, { once: true })
      }
    }
  }

  async push(chunk: ChatStreamChunk): Promise<void> {
    if (this.closed || this.signal?.aborted) return
    const next = this.resolvers.shift()
    if (next) {
      next({ chunk })
      return
    }
    this.buffer.push({ chunk })
    if (this.buffer.length >= this.maxSize) {
      await new Promise<void>((resolve) => {
        this.drainWaiters.push(resolve)
      })
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.signal && this.onAbort) {
      this.signal.removeEventListener('abort', this.onAbort)
    }
    while (this.resolvers.length > 0) {
      const r = this.resolvers.shift()
      r?.(null)
    }
    while (this.drainWaiters.length > 0) {
      const w = this.drainWaiters.shift()
      w?.()
    }
  }

  next(): Promise<BufferedChunk | null> {
    const buffered = this.buffer.shift()
    if (buffered) {
      const waiter = this.drainWaiters.shift()
      if (waiter) waiter()
      return Promise.resolve(buffered)
    }
    if (this.closed) return Promise.resolve(null)
    return new Promise((resolve) => {
      this.resolvers.push(resolve)
    })
  }
}

export interface ChatStreamTraceMetrics {
  textLength: number
  toolCallCount: number
  errorCode?: ChatStreamErrorCode
}

@Injectable()
export class ChatStreamService {
  constructor(
    private readonly store: ChatStoreService,
    private readonly llm: LlmService,
    private readonly logger: PinoLogger,
    @Optional() private readonly braintrust?: BraintrustService,
  ) {
    this.logger.setContext(ChatStreamService.name)
  }

  stream(args: StreamArgs): AsyncIterable<ChatStreamChunk> {
    return {
      [Symbol.asyncIterator]: () => this.run(args),
    }
  }

  private async *run(
    args: StreamArgs,
  ): AsyncGenerator<ChatStreamChunk, void, void> {
    const userMessage = await this.store.appendUserMessageIfAlive({
      conversationId: args.conversationId,
      ownerUserId: args.ownerUserId,
      content: args.userMessage,
      ...(args.clientMessageId !== undefined && {
        clientMessageId: args.clientMessageId,
      }),
    })
    if (!userMessage) {
      yield buildErrorChunk('conversation_not_found')
      return
    }

    const history = await this.store.listRecentMessagesByConversation(
      args.conversationId,
      MAX_CHAT_HISTORY_MESSAGES,
    )
    const messages = toLlmMessages(args.systemPrompt, history)

    const queue = new ChunkQueue(MAX_BUFFERED_CHUNKS, args.signal)
    const textBuffer: string[] = []
    let toolCallCount = 0

    // Ordered display structure of the turn (text runs and tool calls
    // interleaved), built at PRODUCTION time as the model streams — not as the
    // client drains — so it is complete regardless of how far the SSE consumer
    // reads. Persisted only if the turn used a tool (see persistAssistantText).
    const segments: PersistedSegment[] = []
    const pushTextDelta = (delta: string): void => {
      // Skip empty deltas (the OpenAI SDK can terminate a stream with delta:'')
      // so we never open a blank text segment that renders as a phantom bubble.
      if (!delta) return
      const last = segments[segments.length - 1]
      if (last && last.kind === ChatMessageSegmentKind.text) {
        last.text = (last.text ?? '') + delta
      } else {
        segments.push({ kind: ChatMessageSegmentKind.text, text: delta })
      }
    }

    let persistedId: string | undefined
    let persisted = false
    // Set synchronously before the persist await so a second caller (the finally
    // fallback racing driveStream) can't double-write the assistant row.
    let persisting = false
    // Persists the turn exactly once. Writes real content (text and/or a
    // widget-only tool turn on a clean finish); if there is nothing to persist
    // as content, falls back to the interrupted sentinel so the turn is never a
    // zero-row hole — the retry affordance must survive a client disconnect
    // mid-tool-call. Guarded so the driveStream call and the finally fallback
    // can never both write. Note the deliberate trade-off: if a turn is
    // interrupted after a tool already committed to its own record (e.g. an
    // ordinance-flow present_* write), the transcript shows the sentinel while
    // that record keeps the write — the record is the source of truth and Retry
    // re-runs the tool, so the transient mismatch is acceptable.
    const persistOnce = async (cleanFinish: boolean): Promise<void> => {
      if (persisted || persisting) return
      persisting = true
      try {
        const row =
          (await this.persistAssistantText(
            args.conversationId,
            textBuffer.join(''),
            segments,
            cleanFinish,
          )) ??
          // Only an interrupted turn falls back to the sentinel. A clean finish
          // that produced no content was not interrupted — persist nothing
          // rather than a spurious retry affordance.
          (cleanFinish
            ? null
            : await this.persistAssistantText(
                args.conversationId,
                CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER,
              ))
        if (row) {
          persistedId = row.id
          persisted = true
        }
      } catch (persistErr) {
        this.logger.error(
          { err: persistErr, conversationId: args.conversationId },
          'failed to persist assistant message',
        )
      } finally {
        persisting = false
      }
    }

    let result: LlmStreamResult
    try {
      result = await this.llm.streamChatCompletion({
        messages,
        tools: args.tools,
        ...(args.models && { models: args.models }),
        ...(args.maxSteps && { maxSteps: args.maxSteps }),
        ...(args.signal && { abortSignal: args.signal }),
        onToolInputStart: ({ toolName }) => {
          void queue.push({ type: 'tool_input_start', toolName })
        },
        onToolCallStart: ({ name, input }) => {
          toolCallCount += 1
          segments.push({
            kind: ChatMessageSegmentKind.tool,
            toolName: name,
            payload: toJsonPayload(input),
          })
          void queue.push({
            type: 'tool_call',
            toolName: name,
            args: input,
          })
        },
        onToolCallEnd: ({ name, output }) => {
          void queue.push({
            type: 'tool_result',
            toolName: name,
            result: output,
          })
        },
      })
    } catch (err) {
      this.logger.error(
        { err, conversationId: args.conversationId },
        'chat stream connect failed',
      )
      yield buildErrorChunk(classifyError(err, args.signal))
      return
    }

    const consumeStream = async (): Promise<{ error?: Error }> => {
      try {
        for await (const delta of result.textStream) {
          if (args.signal?.aborted) break
          textBuffer.push(delta)
          pushTextDelta(delta)
          await queue.push({ type: 'text', delta })
        }
        return {}
      } catch (err) {
        this.logger.error(
          { err, conversationId: args.conversationId },
          'chat stream textStream iteration failed',
        )
        return {
          error: err instanceof Error ? err : new Error(String(err)),
        }
      } finally {
        queue.close()
      }
    }

    const tracedMetrics: ChatStreamTraceMetrics = {
      textLength: 0,
      toolCallCount: 0,
    }

    const driveStream = async (): Promise<ChatStreamTraceMetrics> => {
      const { error } = await consumeStream()
      tracedMetrics.textLength = textBuffer.reduce(
        (sum, s) => sum + s.length,
        0,
      )
      tracedMetrics.toolCallCount = toolCallCount
      if (error) {
        tracedMetrics.errorCode = classifyError(error, args.signal)
      }
      // Persist the moment generation finishes, decoupled from client draining:
      // an SSE client parked on write backpressure (or a slow/backgrounded tab)
      // must never cost us the turn. A clean tool-only finish still persists so
      // the widget replays on reload; an interrupt leaves it unpersisted here
      // and the finally writes the sentinel instead.
      const cleanFinish = !args.signal?.aborted && !tracedMetrics.errorCode
      await persistOnce(cleanFinish)
      return tracedMetrics
    }

    const streamDone = this.braintrust
      ? this.braintrust.traced('briefing-chat-stream', driveStream, {
          input: {
            conversationId: args.conversationId,
            userMessageLength: args.userMessage.length,
          },
          metadata: {
            ownerUserId: args.ownerUserId,
            toolNames: Object.keys(args.tools),
            ...(args.models && { modelChain: args.models }),
          },
        })
      : driveStream()

    try {
      // The yield loop is now purely client delivery — segments and persistence
      // are handled in driveStream, so a parked consumer can't block either.
      while (true) {
        const next = await queue.next()
        if (!next) break
        yield next.chunk
      }

      const metrics = await streamDone

      if (metrics.errorCode) {
        this.logger.error(
          { conversationId: args.conversationId, code: metrics.errorCode },
          'chat stream failed mid-stream',
        )
        yield buildErrorChunk(metrics.errorCode)
        return
      }

      yield {
        type: 'done',
        ...(persistedId !== undefined && { assistantMessageId: persistedId }),
      }
    } finally {
      // Fallback for a premature return (client returned the iterator before
      // driveStream reached its persist). Pass the real cleanFinish (mirrors
      // driveStream) so an interrupted turn gets the sentinel while a clean
      // finish with no content writes nothing. No-op if already persisted.
      await persistOnce(!args.signal?.aborted && !tracedMetrics.errorCode)
    }
  }

  private async persistAssistantText(
    conversationId: string,
    text: string,
    segments?: PersistedSegment[],
    allowToolOnly = false,
  ): Promise<ChatMessage | null> {
    // Only persist the structure when the turn actually used a tool — a
    // pure-text turn renders identically from `content`, so storing a single
    // text segment would be wasted rows.
    const usedTool = segments?.some(
      (s) => s.kind === ChatMessageSegmentKind.tool,
    )
    // A widget-only turn (tool calls, no text) still persists on a clean finish
    // so the widget replays; without `allowToolOnly` a zero-text turn is
    // dropped (the caller writes the interrupted sentinel instead).
    if (text.length === 0 && !(allowToolOnly && usedTool)) return null
    return this.store.appendMessage({
      conversationId,
      role: ChatMessageRole.assistant,
      content: text,
      ...(usedTool && segments ? { segments } : {}),
    })
  }
}

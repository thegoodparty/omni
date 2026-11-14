import { Injectable } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { PinoLogger } from 'nestjs-pino'
import { toUIMessageStream } from '@ai-sdk/langchain'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
} from '@langchain/core/messages'
import { ChatAnthropic } from '@langchain/anthropic'
import { anthropicPromptCachingMiddleware, createAgent } from 'langchain'
import { ChatMessageRole, ChatMessageSegmentKind } from '@/generated/prisma'
import {
  ChatStoreService,
  type PersistedSegment,
} from '@/chats/services/chatStore.prisma'
import {
  assistantRowToPersist,
  CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER,
  CHAT_STREAM_HEARTBEAT_MS,
  type ChatStreamChunk,
  type FinalizeTurn,
  MAX_CHAT_HISTORY_MESSAGES,
  toJsonPayload,
  type TurnToolEvent,
} from '@/chats/services/chatStream.service'
import { withAgentRun } from '../observability/agentRunSpans'
import type { ChatAgentDefinition } from '../types'
import { LangGraphCheckpointer } from './langGraphCheckpointer'
import { modelCallSpans, toLangChainTool } from './stageGraph'

export type ChatTurnArgs = {
  agentName: string
  agent: ChatAgentDefinition
  conversationId: string
  ownerUserId: number
  organizationSlug: string
  userMessage: string
  clientMessageId?: string
  signal?: AbortSignal
  finalizeText?: (text: string, turn: FinalizeTurn) => string | null
}

const parseToolOutput = (output: unknown): unknown => {
  if (typeof output !== 'string') return output
  try {
    const parsed: unknown = JSON.parse(output)
    return parsed
  } catch {
    return output
  }
}

// A chat turn on LangGraph: the conversation's thread (thread id = the
// ChatConversation id) holds what the model sees, and ChatMessage rows stay
// the display copy the webapp reads. Streams in the webapp's existing chunk
// shape, translated from the AI SDK UI stream @ai-sdk/langchain produces.
@Injectable()
export class LangGraphChatService {
  constructor(
    private readonly store: ChatStoreService,
    private readonly checkpointer: LangGraphCheckpointer,
    private readonly moduleRef: ModuleRef,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LangGraphChatService.name)
  }

  // Seam for tests, which swap in a scripted model.
  chatModel(model: string): BaseChatModel {
    return new ChatAnthropic({ model, maxTokens: 8_192, streaming: true })
  }

  stream(args: ChatTurnArgs): AsyncIterable<ChatStreamChunk> {
    return { [Symbol.asyncIterator]: () => this.run(args) }
  }

  private async *run(
    args: ChatTurnArgs,
  ): AsyncGenerator<ChatStreamChunk, void, void> {
    const userRow = await this.store.appendUserMessageIfAlive({
      conversationId: args.conversationId,
      ownerUserId: args.ownerUserId,
      content: args.userMessage,
      ...(args.clientMessageId !== undefined && {
        clientMessageId: args.clientMessageId,
      }),
    })
    if (!userRow) {
      yield {
        type: 'error',
        code: 'conversation_not_found',
        message: 'Conversation not found.',
        retryable: false,
      }
      return
    }

    const queue: ChatStreamChunk[] = []
    let wake: (() => void) | null = null
    let finished = false
    const push = (chunk: ChatStreamChunk) => {
      queue.push(chunk)
      wake?.()
    }
    const heartbeat = setInterval(
      () => push({ type: 'ping' }),
      CHAT_STREAM_HEARTBEAT_MS,
    )
    const turn = this.produce(args, userRow.id, push).finally(() => {
      clearInterval(heartbeat)
      finished = true
      wake?.()
    })
    turn.catch(() => undefined)

    for (;;) {
      const next = queue.shift()
      if (next) {
        yield next
        continue
      }
      if (finished) break
      await new Promise<void>((resolve) => {
        wake = resolve
      })
      wake = null
    }
    await turn
  }

  private async produce(
    args: ChatTurnArgs,
    userRowId: string,
    push: (chunk: ChatStreamChunk) => void,
  ): Promise<void> {
    const thread = { configurable: { thread_id: args.conversationId } }
    const text: string[] = []
    const segments: PersistedSegment[] = []
    const toolEvents: TurnToolEvent[] = []
    const toolNames = new Map<string, string>()
    const pushText = (delta: string) => {
      if (!delta) return
      text.push(delta)
      const last = segments.at(-1)
      if (last?.kind === ChatMessageSegmentKind.text) {
        last.text = (last.text ?? '') + delta
      } else {
        segments.push({ kind: ChatMessageSegmentKind.text, text: delta })
      }
      push({ type: 'text', delta })
    }

    try {
      await withAgentRun(
        {
          runId: args.conversationId,
          agent: args.agentName,
          shapeHash: 'chat',
        },
        async () => {
          const history = await this.historyToSeed(
            args.conversationId,
            userRowId,
          )
          const system = await args.agent.system({
            conversationId: args.conversationId,
            organizationSlug: args.organizationSlug,
            moduleRef: this.moduleRef,
          })
          const graph = createAgent({
            model: this.chatModel(args.agent.model),
            tools: args.agent.tools.map((t) =>
              toLangChainTool(t, {
                runId: args.conversationId,
                organizationSlug: args.organizationSlug,
                moduleRef: this.moduleRef,
                signal: args.signal ?? new AbortController().signal,
              }),
            ),
            systemPrompt: system,
            checkpointer: this.checkpointer.saver,
            middleware: [
              anthropicPromptCachingMiddleware({
                minMessagesToCache: 1,
                unsupportedModelBehavior: 'ignore',
              }),
              modelCallSpans(args.agent.model),
            ],
          })
          const stream = await graph.stream(
            { messages: [...history, new HumanMessage(args.userMessage)] },
            {
              ...thread,
              streamMode: ['values', 'messages'],
              ...(args.signal && { signal: args.signal }),
            },
          )
          for await (const chunk of toUIMessageStream(stream)) {
            if (chunk.type === 'text-delta') pushText(chunk.delta)
            else if (chunk.type === 'tool-input-start') {
              toolNames.set(chunk.toolCallId, chunk.toolName)
              push({ type: 'tool_input_start', toolName: chunk.toolName })
            } else if (chunk.type === 'tool-input-available') {
              toolNames.set(chunk.toolCallId, chunk.toolName)
              toolEvents.push({
                toolCallId: chunk.toolCallId,
                name: chunk.toolName,
                args: chunk.input,
                status: 'open',
              })
              segments.push({
                kind: ChatMessageSegmentKind.tool,
                toolName: chunk.toolName,
                payload: toJsonPayload(chunk.input),
                toolCallId: chunk.toolCallId,
              })
              push({
                type: 'tool_call',
                toolName: chunk.toolName,
                args: chunk.input,
                toolCallId: chunk.toolCallId,
              })
            } else if (chunk.type === 'tool-output-available') {
              const toolName = toolNames.get(chunk.toolCallId) ?? 'unknown'
              const result = parseToolOutput(chunk.output)
              const index = toolEvents.findIndex(
                (e) => e.toolCallId === chunk.toolCallId && e.status === 'open',
              )
              const open = toolEvents[index]
              if (open && open.status === 'open') {
                toolEvents[index] = { ...open, status: 'returned', result }
              }
              push({
                type: 'tool_result',
                toolName,
                result,
                toolCallId: chunk.toolCallId,
              })
            } else if (chunk.type === 'error') {
              throw new Error(chunk.errorText)
            }
          }
        },
      )

      if (!args.signal?.aborted && args.finalizeText) {
        const extra = args.finalizeText(text.join(''), {
          toolEvents,
          conversationId: args.conversationId,
        })
        if (extra) pushText(extra)
      }
      const row = assistantRowToPersist(text.join(''), segments, true)
      const saved = row
        ? await this.store.appendMessage({
            conversationId: args.conversationId,
            role: ChatMessageRole.assistant,
            ...row,
          })
        : null
      if (saved) await this.recordUsage(args, saved.id)
      push({ type: 'done', ...(saved && { assistantMessageId: saved.id }) })
    } catch (err) {
      const aborted = args.signal?.aborted === true
      this.logger.error(
        { err, conversationId: args.conversationId },
        'langgraph chat turn failed',
      )
      await this.store
        .appendMessage({
          conversationId: args.conversationId,
          role: ChatMessageRole.assistant,
          content:
            text.length > 0
              ? text.join('')
              : CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER,
        })
        .catch(() => undefined)
      push({
        type: 'error',
        code: aborted ? 'aborted' : 'upstream_unavailable',
        message: aborted
          ? 'Chat stream aborted.'
          : 'Chat service is temporarily unavailable.',
        retryable: !aborted,
      })
    }
  }

  // A conversation that started before it had a thread: its earlier turns,
  // from the display copy, go in ahead of this one. Later turns read the
  // thread alone.
  private async historyToSeed(
    conversationId: string,
    userRowId: string,
  ): Promise<BaseMessage[]> {
    const saved = await this.checkpointer.saver.getTuple({
      configurable: { thread_id: conversationId },
    })
    if (saved) return []
    const rows = await this.store.listRecentMessagesByConversation(
      conversationId,
      MAX_CHAT_HISTORY_MESSAGES,
    )
    return rows.flatMap((m): BaseMessage[] => {
      if (m.id === userRowId) return []
      if (m.content === CHAT_INTERRUPTED_BEFORE_OUTPUT_MARKER) return []
      if (m.role === ChatMessageRole.user) return [new HumanMessage(m.content)]
      if (m.role === ChatMessageRole.assistant) {
        return [new AIMessage(m.content)]
      }
      return []
    })
  }

  // The turn's model calls: every AI message after the thread's last human
  // message.
  private async recordUsage(
    args: ChatTurnArgs,
    messageId: string,
  ): Promise<void> {
    const tuple = await this.checkpointer.saver.getTuple({
      configurable: { thread_id: args.conversationId },
    })
    const messages = tuple?.checkpoint.channel_values.messages
    const list = Array.isArray(messages) ? messages : []
    const lastHuman = list.findLastIndex((m) => HumanMessage.isInstance(m))
    const turn = list
      .slice(lastHuman + 1)
      .filter((m): m is AIMessage => AIMessage.isInstance(m))
    const inputTokens = turn.reduce(
      (sum, m) => sum + (m.usage_metadata?.input_tokens ?? 0),
      0,
    )
    const outputTokens = turn.reduce(
      (sum, m) => sum + (m.usage_metadata?.output_tokens ?? 0),
      0,
    )
    await this.store.recordAssistantUsage(messageId, {
      model: args.agent.model,
      inputTokens,
      outputTokens,
    })
  }
}

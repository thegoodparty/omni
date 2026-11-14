import { randomUUID } from 'node:crypto'
import { Injectable, NotFoundException } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import {
  type ChatStreamChunk,
  ChatStreamService,
  type FinalizeTurn,
} from '@/chats/services/chatStream.service'
import type { LlmTool } from '@/llm/services/llm.service'
import { PrismaService } from '@/prisma/prisma.service'
import { CHAT_AGENTS, type ChatAgentName } from '../agents.registry'
import { instrumentTool, withAgentRun } from '../observability/agentRunSpans'
import { isProviderWebSearch } from '../tools/webSearch'
import { chatShapeHash } from './shapeHash'

export type AgentChatTurn = {
  conversationId: string
  ownerUserId: number
  userMessage: string
  signal?: AbortSignal
  clientMessageId?: string
  // The Braintrust span name a scope already uses.
  traceName?: string
  // A scope's guardrail backstop, run on the finished reply as today.
  finalizeText?: (fullText: string, turn: FinalizeTurn) => string | null
}

// The chat path of the AI SDK engine. Chat already runs on the AI SDK's
// loop and the ChatConversation/ChatMessage tables (ChatStreamService), so
// the engine only turns a registry definition into that call: the system
// prompt from the definition, its AgentTools as AI SDK tools, and the turn
// inside withAgentRun so its spans join the conversation in Grafana.
@Injectable()
export class AiSdkChatRuntime {
  constructor(
    private readonly chatStream: ChatStreamService,
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
  ) {}

  stream(
    agent: ChatAgentName,
    turn: AgentChatTurn,
  ): AsyncIterable<ChatStreamChunk> {
    const definition = CHAT_AGENTS[agent]
    const identity = {
      runId: turn.conversationId,
      agent,
      shapeHash: chatShapeHash(definition),
    }
    const run = async function* (
      self: AiSdkChatRuntime,
    ): AsyncGenerator<ChatStreamChunk, void, void> {
      const conversation = await self.prisma.chatConversation.findUnique({
        where: { id: turn.conversationId },
        select: { organizationSlug: true },
      })
      if (!conversation) {
        throw new NotFoundException('Conversation not found')
      }
      const organizationSlug = conversation.organizationSlug ?? ''
      const systemPrompt = await withAgentRun(identity, () =>
        definition.system({
          conversationId: turn.conversationId,
          organizationSlug,
          moduleRef: self.moduleRef,
        }),
      )

      const turnId = turn.clientMessageId ?? randomUUID()
      const signal = turn.signal ?? new AbortController().signal
      const tools: Record<string, LlmTool> = {}
      for (const agentTool of definition.tools) {
        if (isProviderWebSearch(agentTool)) {
          if (process.env.ANTHROPIC_API_KEY) {
            tools[agentTool.name] = {
              kind: 'native_web_search',
              maxUses: agentTool.maxUses,
            }
          }
          continue
        }
        const instrumented = instrumentTool(agentTool)
        let calls = 0
        tools[agentTool.name] = {
          description: agentTool.description,
          inputSchema: agentTool.input,
          execute: (input) =>
            instrumented.execute(input, {
              runId: turn.conversationId,
              stepKey: `chat:${turnId}:${agentTool.name}:${calls++}`,
              organizationSlug,
              signal,
              moduleRef: self.moduleRef,
            }),
        }
      }

      const inner = self.chatStream
        .stream({
          conversationId: turn.conversationId,
          ownerUserId: turn.ownerUserId,
          systemPrompt,
          tools,
          userMessage: turn.userMessage,
          models: [definition.model],
          traceName: turn.traceName ?? `${agent}-chat-stream`,
          signal,
          ...(turn.clientMessageId && {
            clientMessageId: turn.clientMessageId,
          }),
          ...(turn.finalizeText && { finalizeText: turn.finalizeText }),
        })
        [Symbol.asyncIterator]()
      // Each pull runs inside the run's context, so the model call the
      // stream starts and every span under it carry the conversation.
      for (;;) {
        const next = await withAgentRun(identity, () => inner.next())
        if (next.done) return
        yield next.value
      }
    }
    return { [Symbol.asyncIterator]: () => run(this) }
  }
}

import { Injectable } from '@nestjs/common'
import { Prisma } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { ChatStoreService } from './chatStore.prisma'
import {
  agentMessagesToChatMessages,
  sameChatMessage,
} from './chatAgentMessages.util'

export type ChatAgentMessageParity = {
  conversations: number
  countMismatches: string[]
  sampled: number
  sampleMismatches: string[]
}

// Moves every conversation's ChatMessage rows onto AgentMessage and checks
// the two read the same. Reports ids and counts only, never message text.
@Injectable()
export class ChatAgentMessageBackfillService extends createPrismaBase(
  MODELS.ChatConversation,
) {
  constructor(private readonly store: ChatStoreService) {
    super()
  }

  async backfill(
    batchSize = 200,
  ): Promise<{ conversations: number; rowsWritten: number }> {
    let conversations = 0
    let rowsWritten = 0
    let cursor: string | undefined
    while (true) {
      const batch = await this.model.findMany({
        select: { id: true },
        orderBy: { id: Prisma.SortOrder.asc },
        take: batchSize,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      })
      if (batch.length === 0) break
      for (const { id } of batch) {
        rowsWritten += await this.store.syncConversationAgentMessages(id)
      }
      conversations += batch.length
      cursor = batch[batch.length - 1]!.id
    }
    this.logger.info(
      { conversations, rowsWritten },
      'chat AgentMessage backfill finished',
    )
    return { conversations, rowsWritten }
  }

  // Every conversation's message count, then a random sample read in full:
  // each message's id, role, text, pills, cards, citations, model and tokens.
  async parity(sampleSize = 50): Promise<ChatAgentMessageParity> {
    const counts = await this.client.$queryRaw<
      { id: string; chat: bigint; agent: bigint }[]
    >`
      WITH chat AS (
        SELECT conversation_id AS id, count(*) AS n FROM chat_message
        WHERE role::text IN ('user', 'assistant') GROUP BY 1
      ),
      agent AS (
        SELECT conversation_id AS id,
          count(*) FILTER (
            WHERE role::text = 'user'
              OR (role::text = 'assistant' AND previous IS DISTINCT FROM 'tool')
          ) AS n
        FROM (
          SELECT conversation_id, role,
            lag(role::text) OVER (PARTITION BY conversation_id ORDER BY index) AS previous
          FROM agent_message WHERE conversation_id IS NOT NULL
        ) rows GROUP BY 1
      )
      SELECT coalesce(chat.id, agent.id) AS id,
        coalesce(chat.n, 0) AS chat, coalesce(agent.n, 0) AS agent
      FROM chat FULL JOIN agent ON chat.id = agent.id
    `
    const countMismatches = counts
      .filter((row) => row.chat !== row.agent)
      .map((row) => row.id)

    const sample = await this.client.$queryRaw<{ id: string }[]>`
      SELECT id FROM (SELECT DISTINCT conversation_id AS id FROM chat_message) c
      ORDER BY random() LIMIT ${sampleSize}
    `
    const sampleMismatches: string[] = []
    for (const { id } of sample) {
      const [chat, agent] = await Promise.all([
        this.client.chatMessage.findMany({
          where: { conversationId: id, role: { in: ['user', 'assistant'] } },
          orderBy: [
            { createdAt: Prisma.SortOrder.asc },
            { id: Prisma.SortOrder.asc },
          ],
          include: {
            segments: { orderBy: { ordinal: Prisma.SortOrder.asc } },
          },
        }),
        this.client.agentMessage.findMany({
          where: { conversationId: id },
          orderBy: { index: Prisma.SortOrder.asc },
        }),
      ])
      const rebuilt = agentMessagesToChatMessages(agent)
      const same =
        chat.length === rebuilt.length &&
        chat.every((message, i) => {
          const other = rebuilt[i]!
          return (
            message.id === other.id &&
            message.role === other.role &&
            message.model === other.model &&
            message.inputTokens === other.inputTokens &&
            message.outputTokens === other.outputTokens &&
            sameChatMessage(message, other)
          )
        })
      if (!same) sampleMismatches.push(id)
    }
    const result = {
      conversations: counts.length,
      countMismatches,
      sampled: sample.length,
      sampleMismatches,
    }
    this.logger.info(
      {
        conversations: result.conversations,
        countMismatches: countMismatches.length,
        sampled: result.sampled,
        sampleMismatches: sampleMismatches.length,
      },
      'chat AgentMessage parity',
    )
    return result
  }
}

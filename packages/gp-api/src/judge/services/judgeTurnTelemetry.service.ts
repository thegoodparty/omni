import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import type { TurnToolEvent } from '@/chats/services/chatStream.service'
import {
  hashPrompt,
  judgeToolNames,
  judgeToolQueries,
  judgeToolSteps,
  PROMPT_HASH_VERSION,
} from '../judgeTelemetry.util'
import {
  JudgeToolQueriesSchema,
  JudgeToolStepsSchema,
  type ListJudgeTurnsResponse,
} from '../schemas/listJudgeTurns.schema'

export interface RecordTurnArgs {
  sweepId: string
  conversationId: string
  turnIndex: number
  assistantMessageId?: string
  // The exact string handed to the provider, not the one the scope handler
  // built: the greeting fold and the card-note line are added on top of it.
  systemPrompt: string
  toolEvents: TurnToolEvent[]
}

@Injectable()
export class JudgeTurnTelemetryService extends createPrismaBase(
  MODELS.JudgeTurnTelemetry,
) {
  // Upsert and not create: the compound unique on (conversationId, turnIndex)
  // is what makes a retried turn overwrite its own row instead of filing a
  // second opinion about the same turn.
  async recordTurn(args: RecordTurnArgs): Promise<void> {
    const row = {
      sweepId: args.sweepId,
      assistantMessageId: args.assistantMessageId ?? null,
      promptHash: hashPrompt(args.systemPrompt),
      promptHashVersion: PROMPT_HASH_VERSION,
      toolNames: judgeToolNames(args.toolEvents),
      toolSteps: judgeToolSteps(args.toolEvents),
      toolQueries: judgeToolQueries(args.toolEvents),
      // Always null here. The Delta version a turn read is applied by the
      // `VERSION AS OF` rewrite the in-process arm's provider patch performs,
      // and a deployed gp-api neither pins nor reports one: the warehouse
      // response carries columns and rows and nothing else.
      dataVersion: null,
    }
    await this.model.upsert({
      where: {
        conversationId_turnIndex: {
          conversationId: args.conversationId,
          turnIndex: args.turnIndex,
        },
      },
      create: {
        conversationId: args.conversationId,
        turnIndex: args.turnIndex,
        ...row,
      },
      update: row,
    })
  }

  // Owner-scoped: a conversation id on its own must not hand one caller
  // another's prompt hash and tool set, so the conversation is resolved
  // against the caller first and a row that is not theirs is indistinguishable
  // from one that does not exist.
  async listTurns(
    conversationId: string,
    ownerUserId: number,
  ): Promise<ListJudgeTurnsResponse> {
    const conversation = await this.client.chatConversation.findFirst({
      where: { id: conversationId, ownerUserId, deletedAt: null },
      select: { id: true },
    })
    if (!conversation) {
      throw new NotFoundException()
    }

    const rows = await this.model.findMany({
      where: { conversationId },
      orderBy: { turnIndex: Prisma.SortOrder.asc },
    })

    const messageIds = rows
      .map((row) => row.assistantMessageId)
      .filter((id): id is string => id !== null)
    const messages =
      messageIds.length > 0
        ? await this.client.chatMessage.findMany({
            where: { id: { in: messageIds } },
            select: {
              id: true,
              model: true,
              inputTokens: true,
              outputTokens: true,
            },
          })
        : []
    const usageById = new Map(messages.map((m) => [m.id, m]))

    return {
      conversationId,
      turns: rows.map((row) => {
        const usage =
          row.assistantMessageId === null
            ? undefined
            : usageById.get(row.assistantMessageId)
        return {
          sweepId: row.sweepId,
          turnIndex: row.turnIndex,
          assistantMessageId: row.assistantMessageId,
          promptHash: row.promptHash,
          promptHashVersion: row.promptHashVersion,
          toolNames: row.toolNames,
          toolSteps: JudgeToolStepsSchema.parse(row.toolSteps),
          toolQueries: JudgeToolQueriesSchema.parse(row.toolQueries),
          dataVersion: row.dataVersion,
          model: usage?.model ?? null,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          createdAt: row.createdAt,
        }
      }),
    }
  }
}

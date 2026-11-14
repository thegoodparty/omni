import type { ModuleRef } from '@nestjs/core'
import type { z } from 'zod'
import { BriefingAnnotationHandler } from '@/chats/briefing-chats/briefingAnnotation.handler'
import { districtInsightsInputSchema } from '@/llm/tools/districtInsights.tool'
import {
  buildDistrictTopicsTool,
  districtTopicsInputSchema,
} from '@/llm/tools/districtTopics.tool'
import {
  buildGetArtifactsTool,
  getArtifactsInputSchema,
  InMemoryArtifactsProvider,
} from '@/llm/tools/getArtifacts.tool'
import {
  buildGetMyNotesTool,
  getMyNotesInputSchema,
  InMemoryNotesProvider,
} from '@/llm/tools/getMyNotes.tool'
import { PrismaService } from '@/prisma/prisma.service'
import type { AgentTool } from '../tools/tool'
import { webSearch } from '../tools/webSearch'
import type { ChatAgentDefinition } from '../types'

// The briefing chat's context, prompt and per-turn tools stay where they
// are (BriefingAnnotationHandler); this definition puts them behind the
// registry, so any engine can run the chat. The handler reads
// MeetingBriefing.artifact first, which is where the background agent
// writes its briefing.
const briefingTurn = async (conversationId: string, moduleRef: ModuleRef) => {
  const conversation = await moduleRef
    .get(PrismaService, { strict: false })
    .chatConversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { ownerUserId: true },
    })
  if (conversation.ownerUserId === null) {
    throw new Error(`briefing chat ${conversationId} has no owner`)
  }
  const handler = moduleRef.get(BriefingAnnotationHandler, { strict: false })
  const ctx = await handler.loadContext(
    conversationId,
    conversation.ownerUserId,
  )
  return { handler, ctx, tools: handler.buildTools(ctx) }
}

const handlerTool = <I extends z.ZodType>(
  name: string,
  description: string,
  input: I,
): AgentTool<I> => ({
  name,
  description,
  input,
  execute: async (args, ctx) => {
    const target = (await briefingTurn(ctx.runId, ctx.moduleRef)).tools[name]
    if (!target || !('execute' in target)) {
      return { error: `${name} is not available for this briefing` }
    }
    return target.execute(args)
  },
})

const DISTRICT_INSIGHTS_SECTION = '## district_insights'

export const briefingChatAgent: ChatAgentDefinition = {
  model: 'claude-sonnet-4-6',
  system: async ({ conversationId, moduleRef }) => {
    const { handler, ctx, tools } = await briefingTurn(
      conversationId,
      moduleRef,
    )
    const prompt = handler.buildSystemPrompt(ctx)
    // Its description names the tables and filters for this district, so it
    // travels in the prompt rather than on a tool defined once for all.
    const insights = tools.district_insights
    return insights && 'description' in insights
      ? `${prompt}\n\n${DISTRICT_INSIGHTS_SECTION}\n\n${insights.description}`
      : prompt
  },
  tools: [
    webSearch,
    handlerTool(
      'get_artifacts',
      buildGetArtifactsTool({ provider: new InMemoryArtifactsProvider([]) })
        .description,
      getArtifactsInputSchema,
    ),
    handlerTool(
      'get_my_notes',
      buildGetMyNotesTool({ provider: new InMemoryNotesProvider([]) })
        .description,
      getMyNotesInputSchema,
    ),
    handlerTool(
      'list_district_topics',
      buildDistrictTopicsTool().description,
      districtTopicsInputSchema,
    ),
    handlerTool(
      'district_insights',
      `Run one read-only SQL query over this district's constituent data. The tables, columns and filters you may use are in the system prompt under "${DISTRICT_INSIGHTS_SECTION}". Input: sql (the full SELECT) and rationale (one sentence).`,
      districtInsightsInputSchema,
    ),
  ],
}

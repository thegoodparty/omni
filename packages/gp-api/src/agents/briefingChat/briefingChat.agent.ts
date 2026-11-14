import type { ModuleRef } from '@nestjs/core'
import { z } from 'zod'
import { BriefingAnnotationHandler } from '@/chats/briefing-chats/briefingAnnotation.handler'
import { buildDistrictTopicsTool } from '@/llm/tools/districtTopics.tool'
import { buildGetArtifactsTool } from '@/llm/tools/getArtifacts.tool'
import { buildGetMyNotesTool } from '@/llm/tools/getMyNotes.tool'
import { PrismaService } from '@/prisma/prisma.service'
import type { AgentTool } from '../tools/tool'
import { webSearch } from '../tools/webSearch'
import type { ChatAgentDefinition } from '../types'

// The briefing chat's turn context: the briefing, the user's notes and the
// district scope, loaded from the conversation like the AI SDK route does.
const loadTurn = async (conversationId: string, moduleRef: ModuleRef) => {
  const conversation = await moduleRef
    .get(PrismaService, { strict: false })
    .chatConversation.findUnique({
      where: { id: conversationId },
      select: { ownerUserId: true },
    })
  if (conversation?.ownerUserId == null) {
    throw new Error(`conversation ${conversationId} has no owner`)
  }
  const handler = moduleRef.get(BriefingAnnotationHandler, { strict: false })
  const ctx = await handler.loadContext(
    conversationId,
    conversation.ownerUserId,
  )
  return {
    tools: handler.buildTools(ctx),
    system: handler.buildSystemPrompt(ctx),
  }
}

// The registry's tools are fixed, but which of them a briefing offers, and
// district_insights' district scope, depend on the conversation. So each
// tool runs the conversation's own tool, and the system prompt carries the
// per-conversation parts.
const conversationTool = <I extends z.ZodType>(
  name: string,
  description: string,
  input: I,
): AgentTool<I> => ({
  name,
  description,
  input,
  execute: async (args, ctx) => {
    const { tools } = await loadTurn(ctx.runId, ctx.moduleRef)
    const tool = tools[name]
    if (!tool || 'kind' in tool) {
      return { error: `${name} is not available in this conversation` }
    }
    return tool.execute(args)
  },
})

const noArtifacts = { list: async () => [] }
const getArtifacts = buildGetArtifactsTool({ provider: noArtifacts })
const getMyNotes = buildGetMyNotesTool({ provider: noArtifacts })
const districtTopics = buildDistrictTopicsTool()

export const briefingChatAgent: ChatAgentDefinition = {
  model: 'claude-sonnet-4-6',
  system: async ({ conversationId, moduleRef }) => {
    const { tools, system } = await loadTurn(conversationId, moduleRef)
    const district = tools.district_insights
    return district && !('kind' in district)
      ? `${system}\n\n## district_insights in this conversation\n\n${district.description}`
      : system
  },
  tools: [
    conversationTool(
      'get_artifacts',
      getArtifacts.description,
      getArtifacts.inputSchema,
    ),
    webSearch,
    conversationTool(
      'district_insights',
      "Query aggregate constituent data for this conversation's district with one SELECT statement. The table, the required WHERE clause and the rules are in the system prompt under district_insights.",
      z.object({ sql: z.string().min(1), rationale: z.string().min(1) }),
    ),
    conversationTool(
      'list_district_topics',
      districtTopics.description,
      districtTopics.inputSchema,
    ),
    conversationTool(
      'get_my_notes',
      getMyNotes.description,
      getMyNotes.inputSchema,
    ),
  ],
}

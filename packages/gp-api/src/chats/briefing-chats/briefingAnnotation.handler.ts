import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Annotation, ChatScope, MeetingBriefing } from '../../generated/prisma'
import { z } from 'zod'
import type { LlmTool } from '@/llm/services/llm.service'
import type { FinalizeTurn } from '@/chats/services/chatStream.service'
import {
  buildDistrictInsightsTool,
  type MandatoryFilter,
} from '@/llm/tools/districtInsights.tool'
import { buildDistrictTopicsTool } from '@/llm/tools/districtTopics.tool'
import {
  buildGetMyNotesTool,
  Note,
  NotesProvider,
} from '@/llm/tools/getMyNotes.tool'
import { buildGetArtifactsTool } from '@/llm/tools/getArtifacts.tool'
import type { DatabricksProvider } from '@/llm/tools/queryDatabricks.tool'
import { BriefingSchema } from '@/chats/briefing-chats/types/briefing.schema'
import {
  composeAppendix,
  legalAdviceBackstop,
  smallCountBackstop,
} from '@/chats/general/services/guardrailBackstops'
import {
  ADVICE_SIGNALS,
  SECTION_MARK_SIGNAL,
} from '@/chats/general/services/professionalAdviceCheck'
import type {
  ChatScopeHandler,
  ResolveConversationResult,
} from '@/chats/general/types/chatScopeHandler'
import { BriefingArtifactsProvider } from './services/briefingArtifactsProvider'
import {
  BriefingContextOffice,
  BriefingContextResult,
  BriefingContextService,
  BriefingContextUser,
} from './services/briefingContext.service'
import { BriefingNotesService } from './services/briefingNotes.service'
import { DistrictResolverService } from './services/districtResolver.service'
import { extractHighlight, HighlightSnippet } from './services/extractHighlight'
import {
  buildSystemPrompt as buildBriefingSystemPrompt,
  todayInTimezone,
} from './services/systemPromptBuilder'

type ParsedBriefing = z.infer<typeof BriefingSchema>

const SERVE_AGENT_VOTERS_TABLE = 'serve_agent_voters'
const SERVE_AGENT_VOTERS_ALLOWED_TABLES = new Set([SERVE_AGENT_VOTERS_TABLE])

// Sensitive scope: district_insights reads the constituent (voter) mart and its
// rows flow back into the model context, so this scope runs Anthropic-only. The
// registry fails closed if any of these is not claude-routed.
export const BRIEFING_CHAT_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-7',
] as const

// Briefing replies describe agenda items whose material cites code sections
// ("item 2 amends § 5.04"), which is a summary, not a legal reading, so the
// bare section mark is not a signal on this chat. A named statute in a
// summary ("per RCW 35A.33") still draws the line: it points the reader at
// law, and the audit found no summary shape where that misled.
const BRIEFING_LEGAL_SIGNALS = ADVICE_SIGNALS.filter(
  (re) => re !== SECTION_MARK_SIGNAL,
)

// Braintrust filters key on this name, and it predates the registry's
// `${scope}-chat-stream` default, so the handler carries it explicitly.
export const BRIEFING_CHAT_TRACE_NAME = 'briefing-chat-stream'

const safeParseArtifact = (raw: string): ParsedBriefing | null => {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = BriefingSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

export const requireConversationId = (
  chatConversationId: string | null,
): string => {
  if (chatConversationId === null) {
    throw new NotFoundException(
      'Conversation not initialized for this annotation',
    )
  }
  return chatConversationId
}

class LazyNotesProvider implements NotesProvider {
  private cached: Promise<Note[]> | null = null

  constructor(
    private readonly notesService: BriefingNotesService,
    private readonly userId: number,
    private readonly briefingId: string,
    private readonly artifactContent: string,
  ) {}

  list(): Promise<Note[]> {
    if (this.cached === null) {
      const pending = this.notesService.loadNotesForChat({
        userId: this.userId,
        briefingId: this.briefingId,
        artifactContent: this.artifactContent,
      })
      this.cached = pending
      pending.catch(() => {
        if (this.cached === pending) this.cached = null
      })
    }
    return this.cached
  }
}

export interface BriefingChatContext {
  conversationId: string
  userId: number
  annotation: Annotation
  briefing: MeetingBriefing
  artifactContent: string
  user: BriefingContextUser | null
  office: BriefingContextOffice | null
  parsed: ParsedBriefing | null
  today: string
  highlight: HighlightSnippet | null
  notesCount: number
  // Resolved in loadContext because the interface's buildTools is sync; null
  // when the warehouse provider or the caller's district is unavailable.
  districtFilters: MandatoryFilter[] | null
}

// Not @Injectable: BriefingChatsService constructs the single instance from the
// deps it already holds, and briefing-chats.module republishes that instance
// under this class token. One wiring feeds both the live send path and the
// scope registry, so the two cannot drift apart.
export class BriefingAnnotationHandler implements ChatScopeHandler<BriefingChatContext> {
  readonly scope = ChatScope.briefing_annotation
  readonly isSensitive = true
  readonly models = [...BRIEFING_CHAT_MODELS]
  readonly traceName = BRIEFING_CHAT_TRACE_NAME
  // The briefing route never titled a conversation; /v1/chats must not either.
  readonly setsTitle = false

  constructor(
    private readonly briefingContext: BriefingContextService,
    private readonly notesService: BriefingNotesService,
    private readonly databricks?: DatabricksProvider,
    private readonly districtResolver?: DistrictResolverService,
  ) {}

  // A briefing conversation is created annotation-first, in one transaction
  // with its Annotation (POST /v1/briefing-chats), so the generic create path
  // cannot produce a usable one — it would leave a conversation no annotation
  // points at. Closing the hook here keeps the default from creating that row.
  async resolveConversation(): Promise<ResolveConversationResult> {
    throw new BadRequestException(
      'briefing_annotation conversations are created with their annotation',
    )
  }

  async loadContext(
    conversationId: string,
    userId: number,
  ): Promise<BriefingChatContext> {
    return this.toContext(
      await this.briefingContext.loadContextByConversation(
        conversationId,
        userId,
      ),
      userId,
    )
  }

  // The annotation-keyed entry the briefing routes use. The interface hands
  // loadContext a conversationId, which resolves back to the same context via
  // the unique Annotation.chatConversationId.
  async loadContextForAnnotation(
    annotationId: string,
    userId: number,
  ): Promise<BriefingChatContext> {
    return this.toContext(
      await this.briefingContext.loadContext(annotationId, userId),
      userId,
    )
  }

  buildSystemPrompt(ctx: BriefingChatContext): string {
    return buildBriefingSystemPrompt({
      annotation: ctx.annotation,
      briefing: ctx.briefing,
      artifactContent: ctx.artifactContent,
      today: ctx.today,
      availableToolNames: Object.keys(this.assembleTools(ctx)),
      notesCount: ctx.notesCount,
      user: ctx.user,
      office: ctx.office,
      highlight: ctx.highlight,
      parsed: ctx.parsed,
    })
  }

  buildTools(ctx: BriefingChatContext): Record<string, LlmTool> {
    return this.assembleTools(ctx)
  }

  // A statute reading the model left uncautioned gets the legal line, and a
  // district_insights result that dropped small cells gets the count note
  // when the reply did not say so itself.
  finalizeAssistantText(text: string, turn: FinalizeTurn): string | null {
    return composeAppendix([
      legalAdviceBackstop(text, 'briefing_chat', BRIEFING_LEGAL_SIGNALS),
      smallCountBackstop(text, 'briefing_chat', turn.toolEvents),
    ])
  }

  private async toContext(
    loaded: BriefingContextResult,
    userId: number,
  ): Promise<BriefingChatContext> {
    const { annotation, briefing, artifactContent, user, office } = loaded
    const conversationId = requireConversationId(annotation.chatConversationId)
    const [districtFilters, notesCount] = await Promise.all([
      this.resolveDistrictFilters(loaded.organizationSlug),
      this.notesService.countNotesForUser({
        userId,
        briefingId: briefing.id,
      }),
    ])
    return {
      conversationId,
      userId,
      annotation,
      briefing,
      artifactContent,
      user,
      office,
      parsed: safeParseArtifact(artifactContent),
      today: todayInTimezone(briefing.meetingTimezone),
      highlight: extractHighlight(artifactContent, annotation),
      notesCount,
      districtFilters,
    }
  }

  // Resolve by the briefing's org, not the user: an official with offices in
  // multiple orgs would otherwise get whichever ElectedOffice row came back
  // first, locking the voter-data filters to another org's district.
  private async resolveDistrictFilters(
    organizationSlug: string,
  ): Promise<MandatoryFilter[] | null> {
    if (!this.databricks || !this.districtResolver) return null
    const resolved =
      await this.districtResolver.resolveByOrgSlug(organizationSlug)
    return resolved ? this.districtResolver.toMandatoryFilters(resolved) : null
  }

  private assembleTools(ctx: BriefingChatContext): Record<string, LlmTool> {
    const tools: Record<string, LlmTool> = {}
    const artifactsProvider = new BriefingArtifactsProvider(
      ctx.parsed,
      ctx.briefing.id,
    )
    tools.get_artifacts = buildGetArtifactsTool({ provider: artifactsProvider })

    // Web search via Anthropic's native tool (briefing chat is Claude-only), so
    // queries stay within the enterprise agreement. Gated on the key here too
    // so the system prompt never advertises a tool that wasn't registered.
    if (process.env.ANTHROPIC_API_KEY) {
      tools.web_search = { kind: 'native_web_search', maxUses: 5 }
    }

    if (this.databricks && ctx.districtFilters) {
      tools.district_insights = buildDistrictInsightsTool({
        provider: this.databricks,
        allowedTables: SERVE_AGENT_VOTERS_ALLOWED_TABLES,
        mandatoryFilters: ctx.districtFilters,
      })
      tools.list_district_topics = buildDistrictTopicsTool()
    }

    if (ctx.notesCount > 0) {
      const lazyProvider = new LazyNotesProvider(
        this.notesService,
        ctx.userId,
        ctx.briefing.id,
        ctx.artifactContent,
      )
      tools.get_my_notes = buildGetMyNotesTool({ provider: lazyProvider })
    }

    return tools
  }
}

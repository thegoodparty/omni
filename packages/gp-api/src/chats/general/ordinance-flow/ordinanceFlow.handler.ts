import { BadRequestException, Injectable } from '@nestjs/common'
import { ChatConversation, ChatScope } from '../../../generated/prisma'
import type { LlmTool } from '@/llm/services/llm.service'
import {
  ChatAnchorSchema,
  type OrdinanceFlowStep,
} from '@goodparty_org/contracts'
import {
  ChatScopeHandler,
  ResolveConversationParams,
  ResolveConversationResult,
} from '../types/chatScopeHandler'
import { GeneralChatStoreService } from '../services/generalChatStore.prisma'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import {
  OrdinanceFlowContext,
  OrdinanceFlowContextService,
} from './services/ordinanceFlowContext.service'
import { buildOrdinanceFlowSystemPrompt } from './services/ordinanceFlowPrompt'

// Sensitive scope: the ordinance record and its research (constituent-derived
// rationales, drafts) flow into the model context, so it runs Anthropic-only.
// The registry fails closed if any of these is not claude-routed.
export const ORDINANCE_FLOW_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-7',
] as const

@Injectable()
export class OrdinanceFlowHandler implements ChatScopeHandler<OrdinanceFlowContext> {
  readonly scope = ChatScope.ordinance_flow
  readonly isSensitive = true
  readonly models = [...ORDINANCE_FLOW_MODELS]

  constructor(
    private readonly store: GeneralChatStoreService,
    private readonly contextService: OrdinanceFlowContextService,
    private readonly districtResolver?: DistrictResolverService,
  ) {}

  // One conversation per (ordinance, step): reopening a step resumes its own
  // thread rather than starting fresh. We filter the small per-ordinance
  // candidate set by the anchor's step in code (a single JSON where-clause
  // can't match two anchor paths at once). Best-effort find-or-create, matching
  // the other general-chat scopes: a rare concurrent double-open of the same
  // step can race to two threads, which is harmless — resume just picks the
  // newest, and no unique constraint exists to lean on (the key lives in the
  // JSON anchor). Not worth serializing for the severity.
  async resolveConversation(
    params: ResolveConversationParams,
    userId: number,
  ): Promise<ResolveConversationResult> {
    const anchor = params.anchor
    if (!anchor || anchor.resourceType !== 'ordinance') {
      throw new BadRequestException(
        'ordinance_flow requires an ordinance anchor',
      )
    }

    const candidates = await this.store.findByAnchorResource({
      ownerUserId: userId,
      organizationSlug: params.organizationSlug,
      scope: ChatScope.ordinance_flow,
      resourceId: anchor.resourceId,
    })
    const match = candidates.find(
      (c) => this.anchorStep(c.anchor) === anchor.step,
    )
    if (match) {
      return { conversationId: match.id, created: false }
    }

    // Authorize before creating: the anchor's resourceId is client-supplied, so
    // verify the caller's office owns the ordinance before writing a
    // conversation record anchored to it (load() enforces the same invariant on
    // the message-send path).
    await this.contextService.assertOrdinanceOwnership(
      anchor.resourceId,
      userId,
      params.organizationSlug ?? '',
    )

    const created = await this.store.createScopedConversation({
      ownerUserId: userId,
      organizationSlug: params.organizationSlug,
      scope: ChatScope.ordinance_flow,
      anchor,
      title: anchor.snapshot.title,
    })
    return { conversationId: created.id, created: true }
  }

  async loadContext(
    conversationId: string,
    userId: number,
  ): Promise<OrdinanceFlowContext> {
    const ctx = await this.contextService.load(conversationId, userId)
    // Resolve by the conversation's org slug, not the user: an official with
    // offices in multiple orgs would otherwise get whichever ElectedOffice row
    // came back first, and thus the wrong jurisdiction.
    const resolved = await this.districtResolver?.resolveByOrgSlug(
      ctx.organizationSlug,
    )
    if (!resolved) return ctx
    return {
      ...ctx,
      jurisdiction: `${resolved.l2DistrictName}, ${resolved.state}`,
    }
  }

  buildSystemPrompt(ctx: OrdinanceFlowContext): string {
    return buildOrdinanceFlowSystemPrompt({ ctx, toolNames: [] })
  }

  // The flow's write/read tools (save_step_content, ask_clarify_question,
  // read_ordinance, web_search, ...) land in slice 3. The scope still streams
  // plain chat until then.
  buildTools(): Record<string, LlmTool> {
    return {}
  }

  private anchorStep(
    raw: ChatConversation['anchor'],
  ): OrdinanceFlowStep | null {
    if (raw === null) return null
    const parsed = ChatAnchorSchema.safeParse(raw)
    return parsed.success && parsed.data.resourceType === 'ordinance'
      ? parsed.data.step
      : null
  }
}

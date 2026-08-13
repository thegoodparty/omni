import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { ChatConversation, ChatScope } from '../../../generated/prisma'
import type { LlmStreamUsage, LlmTool } from '@/llm/services/llm.service'
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
import { FeaturesService } from 'src/features/services/features.service'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import {
  OrdinanceFlowContext,
  OrdinanceFlowContextService,
} from './services/ordinanceFlowContext.service'
import { OrdinanceFlowToolsService } from './services/ordinanceFlowTools.service'
import { OrdinanceFlowFetchService } from './services/ordinanceFlowFetch.service'
import { OrdinanceFlowSearchService } from './services/ordinanceFlowSearch.service'
import {
  buildAcceptDraftChangesTool,
  buildApplyDraftEditTool,
  buildAskClarifyQuestionTool,
  buildBraveSearchTool,
  buildFetchUrlTool,
  buildGetCodeSourceTool,
  buildOfferNextStepTool,
  buildPresentAuthorityFindingTool,
  buildPresentComparablesTool,
  buildPresentCurrentLawSummaryTool,
  buildPresentDraftTool,
  buildPresentLegislativeHistoryTool,
  buildReadOrdinanceTool,
  buildSaveExistingLawTool,
  buildSaveNoteTool,
  buildSaveSynthesisTool,
  type OrdinanceToolDeps,
} from './tools/ordinanceFlowTools'
import { buildOrdinanceFlowSystemPrompt } from './services/ordinanceFlowPrompt'

// Sensitive scope: the ordinance record and its research (constituent-derived
// rationales, drafts) flow into the model context, so it runs Anthropic-only.
// The registry fails closed if any of these is not claude-routed.
export const ORDINANCE_FLOW_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-7',
] as const

const SERVE_ORDINANCES_FLAG = 'serve-ordinances'

@Injectable()
export class OrdinanceFlowHandler implements ChatScopeHandler<OrdinanceFlowContext> {
  readonly scope = ChatScope.ordinance_flow
  readonly isSensitive = true
  readonly models = [...ORDINANCE_FLOW_MODELS]
  // Per-turn tool-loop ceiling (stopWhen: stepCountIs), reset every message —
  // not a whole-conversation budget. A current_law research turn chains
  // get_code_source + repeated brave_search/fetch_url rounds (chasing a
  // server-rendered copy when Municode renders blank) + save_existing_law + two
  // present_* widgets; at 8 it exhausted the budget mid-research and never
  // presented. 30 gives generous headroom; lighter steps stop well short.
  readonly maxSteps = 30

  constructor(
    private readonly store: GeneralChatStoreService,
    private readonly contextService: OrdinanceFlowContextService,
    private readonly tools: OrdinanceFlowToolsService,
    private readonly fetch: OrdinanceFlowFetchService,
    private readonly search: OrdinanceFlowSearchService,
    private readonly features: FeaturesService,
    private readonly districtResolver?: DistrictResolverService,
  ) {}

  // Gate the whole scope on the serve-ordinances flag, the same way every
  // OrdinancesService REST method does — otherwise a flag-off user could open
  // or message an ordinance_flow chat via POST /chats, bypassing the gate the
  // rest of the feature enforces.
  private async assertEnabled(userId: number): Promise<void> {
    const enabled = await this.features.isFeatureEnabled({
      user: userId,
      feature: SERVE_ORDINANCES_FLAG,
    })
    if (!enabled) {
      throw new ForbiddenException('Ordinances is not enabled')
    }
  }

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
    await this.assertEnabled(userId)

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
    await this.assertEnabled(userId)
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
      officeLevel: resolved.level,
    }
  }

  buildSystemPrompt(ctx: OrdinanceFlowContext): string {
    return buildOrdinanceFlowSystemPrompt({
      ctx,
      toolNames: Object.keys(this.assembleTools(ctx)),
    })
  }

  buildTools(ctx: OrdinanceFlowContext): Record<string, LlmTool> {
    return this.assembleTools(ctx)
  }

  // Meter each turn's tokens onto the ordinance record (a full-draft total sums
  // these with the quality loop's own tokens). The runtime only calls this on a
  // clean finish and swallows a throw, so metering never affects the reply.
  async onTurnUsage(
    ctx: OrdinanceFlowContext,
    usage: LlmStreamUsage,
    model: string,
  ): Promise<void> {
    await this.tools.recordFlowUsage({
      ordinanceId: ctx.ordinanceId,
      electedOfficeId: ctx.electedOfficeId,
      step: ctx.step,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    })
  }

  private assembleTools(ctx: OrdinanceFlowContext): Record<string, LlmTool> {
    const deps: OrdinanceToolDeps = {
      service: this.tools,
      fetch: this.fetch,
      search: this.search,
      ordinanceId: ctx.ordinanceId,
      electedOfficeId: ctx.electedOfficeId,
      organizationSlug: ctx.organizationSlug,
      step: ctx.step,
    }
    const tools: Record<string, LlmTool> = {
      read_ordinance: buildReadOrdinanceTool(deps),
      get_code_source: buildGetCodeSourceTool(deps),
      save_note: buildSaveNoteTool(deps),
      // On every step: current-law uses it for primary research, and any step
      // can fetch a source the user pastes to correct that step's finding.
      fetch_url: buildFetchUrlTool(deps),
    }

    // Web search runs through Anthropic's native tool (the scope is Claude-only)
    // so queries stay within the enterprise agreement. Gated on the key here so
    // the system prompt never advertises a tool that was not registered.
    if (process.env.ANTHROPIC_API_KEY) {
      tools.web_search = { kind: 'native_web_search', maxUses: 5 }
    }

    // The adaptive Clarify Q&A only belongs on the clarify step; other steps
    // (authority, comparables, draft) get their own tools in later slices.
    if (ctx.step === 'clarify') {
      tools.ask_clarify_question = buildAskClarifyQuestionTool()
      tools.save_synthesis = buildSaveSynthesisTool(deps)
    }

    // Each step gets only the present_* display tools its page renders.
    if (ctx.step === 'authority') {
      tools.present_authority_finding = buildPresentAuthorityFindingTool(deps)
    }

    // Current-law research reads the live code and persists its findings, then
    // presents the summary and legislative-history widgets. (fetch_url is a
    // base tool now, shared with the source-correction path on every step.)
    if (ctx.step === 'current_law') {
      tools.save_existing_law = buildSaveExistingLawTool(deps)
      tools.present_current_law_summary = buildPresentCurrentLawSummaryTool()
      tools.present_legislative_history = buildPresentLegislativeHistoryTool()
      // Brave returns fetchable result URLs (Anthropic's native web_search
      // hides them), so the model can find a server-rendered copy when
      // fetch_url hits a browser-only page like Municode. Gated on the key so
      // the system prompt never advertises a tool that was not registered.
      if (process.env.BRAVE_API_KEY) {
        tools.brave_search = buildBraveSearchTool(deps)
      }
    }

    if (ctx.step === 'comparables') {
      tools.present_comparables = buildPresentComparablesTool(deps)
    }

    // The terminal step synthesizes the prior steps into a complete draft and
    // persists it to the ordinance's draft columns.
    if (ctx.step === 'draft') {
      tools.present_draft = buildPresentDraftTool(deps)
      // For the rare drafting-blocker question only (DRAFT RULES cap it at
      // one) — so even that question rides the widget and persists as a
      // clarify answer instead of a prose interview the record never sees.
      tools.ask_clarify_question = buildAskClarifyQuestionTool()
    }

    // The post-draft review chat can apply a specific requested edit to the
    // draft in place as tracked-change redline, and (for a new ordinance)
    // accept those changes into clean final text — both reviewed in the editor.
    if (ctx.step === 'review') {
      tools.apply_draft_edit = buildApplyDraftEditTool(deps)
      tools.accept_draft_changes = buildAcceptDraftChangesTool(deps)
    }

    // A numbered flow step can offer a button to advance. The terminal draft
    // step and the post-draft review chat have nowhere to advance to.
    if (ctx.step !== 'draft' && ctx.step !== 'review') {
      tools.offer_next_step = buildOfferNextStepTool()
    }

    return tools
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

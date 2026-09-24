import { ChatScope } from '../../../generated/prisma'
import type { LlmTool, LlmStreamUsage } from '@/llm/services/llm.service'
import type { ChatAnchor } from '@goodparty_org/contracts'

// Params a client sends to resolve a conversation. Scope is always present;
// the rest is scope-specific. The default resolution keys on the authed user +
// organization slug (slug resolved server-side from the header, not the body).
export interface ResolveConversationParams {
  scope: ChatScope
  organizationSlug: string | null
  anchor?: ChatAnchor
}

export interface ResolveConversationResult {
  conversationId: string
  created: boolean
}

// Opaque per-scope context produced by loadContext and threaded into the
// prompt + tool builders. Each handler narrows it to its own shape.
export type ScopeContext = object

export interface ChatScopeHandler<
  TContext extends ScopeContext = ScopeContext,
> {
  scope: ChatScope
  // Sensitive scopes run Anthropic-only (see model routing / fail-closed). CoS
  // is sensitive because tool outputs can carry constituent data into the next
  // turn's context.
  isSensitive: boolean
  // Claude-only model chain for this scope, in fallback order.
  models: string[]
  // Raises the tool-loop step budget for research-heavy scopes.
  readonly maxSteps?: number
  // Optional override of the session model. Leave it off to get the default
  // every conversational scope shares: one fresh conversation per open, with
  // resuming done by opening a past conversation by id (history → listMessages
  // → stream). Chief of Staff and Campaign Manager both run on that default and
  // must stay on it — a per-scope copy is how the two drifted apart before.
  // Override only for a genuinely different model (ordinance flow keys one
  // conversation to an (ordinance, step) anchor).
  resolveConversation?: (
    params: ResolveConversationParams,
    userId: number,
  ) => Promise<ResolveConversationResult>
  // Optional hook run after the default creates a conversation, for a scope
  // that opens with something already in the transcript.
  seedConversation?: (
    conversationId: string,
    params: ResolveConversationParams,
  ) => Promise<void>
  loadContext: (conversationId: string, userId: number) => Promise<TContext>
  buildSystemPrompt: (ctx: TContext) => string
  buildTools: (ctx: TContext) => Record<string, LlmTool>
  // Optional pre-LLM hook: return a deterministic assistant reply for a
  // recognized message (e.g. a kickoff sentinel) to skip the model; return
  // null to run the normal turn.
  maybeCannedReply?: (userMessage: string, ctx: TContext) => string | null
  // Optional post-turn hook: receives the turn's resolved token usage and the
  // model that produced it, after a clean finish. Scopes that meter cost (the
  // ordinance flow) implement it; a throw is logged, never fails the turn.
  onTurnUsage?: (
    ctx: TContext,
    usage: LlmStreamUsage,
    model: string,
  ) => void | Promise<void>
  // Optional post-generation hook: given the full assembled assistant text on a
  // clean finish, return a line to append (e.g. the CoS professional-advice
  // disclaimer) or null to append nothing. The shared stream service streams it
  // as the final text chunk and persists it with the turn.
  finalizeAssistantText?: (text: string) => string | null
}

export const CHAT_SCOPE_HANDLERS = 'CHAT_SCOPE_HANDLERS'

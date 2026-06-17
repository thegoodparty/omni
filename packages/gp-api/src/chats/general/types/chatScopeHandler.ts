import { z } from 'zod'
import { ChatScope } from '../../../generated/prisma'
import type { LlmStreamTool } from '@/llm/services/llm.service'

// Params a client sends to resolve (find-or-create) a conversation. Scope is
// always present; the rest is scope-specific. CoS keys on the authed user +
// organization slug (slug resolved server-side from the header, not the body).
export interface ResolveConversationParams {
  scope: ChatScope
  organizationSlug: string | null
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
  resolveConversation: (
    params: ResolveConversationParams,
    userId: number,
  ) => Promise<ResolveConversationResult>
  loadContext: (conversationId: string, userId: number) => Promise<TContext>
  buildSystemPrompt: (ctx: TContext) => string
  buildTools: (ctx: TContext) => Record<string, LlmStreamTool<z.ZodTypeAny>>
}

export const CHAT_SCOPE_HANDLERS = 'CHAT_SCOPE_HANDLERS'

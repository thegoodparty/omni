import type { ModelMessage, ToolSet } from 'ai'

// Anthropic prompt caching: a `cache_control` breakpoint caches the whole
// prompt prefix up to it (tools, then system, then messages) for 5 minutes,
// and a later request that starts with the same bytes reads it at 10% of the
// input price (a write costs 125%). A prefix under the model's minimum
// (1,024 tokens for Sonnet/Opus, 4,096 for Haiku 4.5) is silently not cached,
// so marking a short prompt is harmless. The provider allows 4 breakpoints
// per request: tools (1) + system (1) + conversation tail (up to 2) fit.
const EPHEMERAL = {
  anthropic: { cacheControl: { type: 'ephemeral' } },
} as const

const withBreakpoint = (message: ModelMessage): ModelMessage => ({
  ...message,
  providerOptions: { ...message.providerOptions, ...EPHEMERAL },
})

/** Marks the last system message: caches the tool block and system prompt. */
export const withSystemCache = (messages: ModelMessage[]): ModelMessage[] => {
  const idx = messages.findLastIndex((m) => m.role === 'system')
  return idx === -1
    ? messages
    : messages.map((m, i) => (i === idx ? withBreakpoint(m) : m))
}

/**
 * Marks the final message so the next request that extends this conversation
 * (the next chat turn, or the next step of a tool loop) reads everything up to
 * here from cache.
 */
export const withTailCache = (messages: ModelMessage[]): ModelMessage[] =>
  messages.length === 0
    ? messages
    : messages.map((m, i) =>
        i === messages.length - 1 ? withBreakpoint(m) : m,
      )

/**
 * Marks the last client tool so tool definitions stay cached even when the
 * system prompt changes. Provider tools (native web search) have no
 * providerOptions slot and are left alone.
 */
export const withToolsCache = (tools: ToolSet): ToolSet => {
  const names = Object.keys(tools).filter((n) => tools[n]?.type !== 'provider')
  const last = names[names.length - 1]
  if (last === undefined) return tools
  const t = tools[last]
  if (!t) return tools
  return {
    ...tools,
    [last]: { ...t, providerOptions: { ...t.providerOptions, ...EPHEMERAL } },
  } as ToolSet
}

export interface LlmCacheUsage {
  cachedInputTokens: number
  cacheWriteTokens: number
}

/** Cache read/write token counts from an AI SDK usage object. */
export const readCacheUsage = (usage: {
  inputTokenDetails?: {
    cacheReadTokens?: number | undefined
    cacheWriteTokens?: number | undefined
  }
}): LlmCacheUsage => ({
  cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
  cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
})

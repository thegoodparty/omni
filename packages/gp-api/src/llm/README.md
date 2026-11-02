# `src/llm/`

Centralized LLM call surface. Wraps the Vercel `ai` SDK against Anthropic Claude.
Application code goes through `LlmService` rather than importing `ai` or
`@ai-sdk/anthropic` directly.

- **Non-streaming** (`chatCompletion`, `jsonCompletion`, `toolCompletion`) use
  `generateText` / `generateObject` from the `ai` SDK.
- **Streaming** (`streamChatCompletion`) uses `streamText`.

Message and tool types (`LlmMessage`, `LlmFunctionTool`, `LlmToolChoice`) are local
DTOs defined in `src/llm/types/llmMessages.types.ts`.

Use this module when you need an LLM call. Don't add new direct `ai` SDK or
`@ai-sdk/anthropic` imports outside `src/llm/services/`.

## Prompt caching

Every call goes to Anthropic, and `LlmService` adds `cache_control` breakpoints
(`services/promptCache.ts`) so a prefix reused across calls is read at 10% of
the input price (a write costs 125%, the TTL is 5 minutes). It is on by default
and each call takes `promptCache: false` to turn it off.

- **One-shot** (`chatCompletion`, `jsonCompletion`, `toolCompletion`): a
  breakpoint on the last system message, which also caches the tool or schema
  block ahead of it. `toolCompletion` also marks its last tool.
- **Streaming** (`streamChatCompletion`): breakpoints on the last client tool,
  the system prompt, the conversation tail, and (in `prepareStep`) the tail of
  each later tool-loop step. That is 4, the provider's cap. Anthropic's native
  web search tool has no slot for one and is skipped.

Keep the stable part of a prompt first: system prompt, then tools, then history.
Anything that changes per call (a timestamp, a per-request context block) goes
last, or in the user message, because a changed byte invalidates everything
after it. A prefix under the model's minimum (1,024 tokens for Sonnet and Opus,
4,096 for Haiku 4.5) is silently not cached, so a short prompt costs nothing
extra. Pass `promptCache: false` for a call whose system prompt differs on
every call and is long, where the write premium is never earned back.

Cache read/write tokens come back as `cache` on one-shot results and as
`cachedInputTokens` / `cacheWriteTokens` on stream `usage`, and every call logs
them (`LLM usage`, `LLM stream usage`). `inputTokens` already includes them.

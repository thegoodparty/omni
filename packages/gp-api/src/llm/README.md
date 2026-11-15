# `src/llm/`

Centralized LLM call surface. Wraps the Vercel `ai` SDK against Anthropic Claude.
Application code goes through `LlmService` rather than importing `ai` or
`@ai-sdk/anthropic` directly.

- **Non-streaming** (`chatCompletion`, `jsonCompletion`, `toolCompletion`) use
  `generateText` / `generateObject` from the `ai` SDK.
- **Streaming** (`streamChatCompletion`) uses `streamText`.

## Prompt caching

Anthropic caches nothing unless the request asks for it.
`streamChatCompletion` asks with a top-level `cacheControl`, which caches up to
the last block and moves forward as the conversation grows. Each tool step and
each follow-up turn within 5 minutes reads the earlier prompt at a tenth of the
input price.

- It only hits when everything before the new content is byte-identical. A
  system prompt that changes between turns (the page line, live data, the date
  line at midnight) costs that turn a full cache write. Keep per-turn content
  stable or at the end.
- The non-streaming calls do not cache. They rarely repeat a prompt, so they
  would pay the 1.25x write premium and never read it back. A caller that
  reuses a large, fixed system prompt across many calls should add an explicit
  breakpoint on that block instead.
- `LlmStreamUsage.inputTokens` includes cache reads and writes; the split is
  in `cacheReadTokens` and `cacheWriteTokens`. Anything that prices
  `inputTokens` at the full input rate (`chat_message.input_tokens`,
  `ordinanceCost.util.ts`) now reports an upper bound.

Message and tool types (`LlmMessage`, `LlmFunctionTool`, `LlmToolChoice`) are local
DTOs defined in `src/llm/types/llmMessages.types.ts`.

Use this module when you need an LLM call. Don't add new direct `ai` SDK or
`@ai-sdk/anthropic` imports outside `src/llm/services/`.

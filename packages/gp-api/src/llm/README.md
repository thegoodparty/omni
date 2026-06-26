# `src/llm/`

Centralized LLM call surface. Wraps the Vercel `ai` SDK against Anthropic only — no
OpenAI, no Together AI runtime path. Application code never imports `ai` or
`@ai-sdk/anthropic` directly.

- **Non-streaming** (`chatCompletion`, `jsonCompletion`, `toolCompletion`) use
  `generateText` / `generateObject` from the `ai` SDK.
- **Streaming** (`streamChatCompletion`) uses `streamText`.

Message and tool types (`LlmMessage`, `LlmFunctionTool`, `LlmToolChoice`) are local
DTOs defined in `src/llm/types/llmMessages.types.ts` — no `openai` package types.

Use this module when you need an LLM call. Don't add new direct `ai` SDK or
`@ai-sdk/anthropic` imports outside `src/llm/services/`.

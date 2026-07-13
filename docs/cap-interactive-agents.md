# CAP — interactive agents (the `ai`-SDK chat model)

The interactive half of CAP is a synchronous, streaming chat agent that answers a
user in real time, calling tools as it goes. It lives **entirely in gp-api**, built
on the Vercel `ai` SDK. This is distinct from the background agents
([`cap-background-agents.md`](cap-background-agents.md)) — different runtime,
different repo footprint, different lifecycle. Read the overview first:
[`cap.md`](cap.md).

All paths below are under `packages/gp-api/`.

## One wrapper, a few surfaces

Every interactive surface funnels through one wrapper — `src/llm/` (`LlmService`
plus the `ai`-SDK `tool()` definitions in `src/llm/tools/`) — which calls **Anthropic
Claude through the Vercel `ai` SDK**. There is a single provider and a single code
path; a surface is just a controller plus the choices it makes when it calls
`LlmService`:

- **Prompt source** — assembled in-code from composable blocks (`src/chats/`), or
  pulled from Contentful and token-substituted (`src/campaigns/ai/`).
- **Tools** — a surface may register `ai`-SDK tools for the model to call, or none.
- **Streaming** — SSE token streaming with multi-step tool loops, or a single
  non-streaming completion.
- **Persistence** — normalized `ChatConversation`/`ChatMessage` rows, or a single
  `AiChat` JSONB blob.

The sections below describe the wrapper, then catalog the surfaces and where they sit
on those axes.

## `LlmService` — the central wrapper

`src/llm/services/llm.service.ts`. The whole interactive model funnels through this
one class. Dependencies (`package.json`): `ai` and `@ai-sdk/anthropic`.
`ANTHROPIC_API_KEY` is required at startup.

All paths resolve to Anthropic via `@ai-sdk/anthropic` (`resolveChatModel` always
calls `anthropicProvider.languageModel(model)`). DI tokens:
`STREAM_TEXT_TOKEN` / `GENERATE_TEXT_TOKEN` / `GENERATE_OBJECT_TOKEN` /
`ANTHROPIC_PROVIDER_FACTORY_TOKEN`.

- **Non-streaming** (`chatCompletion`, `toolCompletion`) use `generateText` from the
  `ai` SDK. `jsonCompletion` uses `generateObject` with a Zod schema.
- **Streaming** (`streamChatCompletion`) uses `streamText` with
  `stopWhen: stepCountIs(maxSteps)` (default 5) for multi-step tool loops.

Models come from env: `AI_MODELS` (comma-separated default chain, required — set to
`claude-sonnet-4-6` in `deploy/index.ts`) plus an optional `AI_FALLBACK_MODEL`.
`withModelFallback` wraps `async-retry` — transient errors cascade to the next model
then retry; 4xx errors `bail()` immediately.
**Streaming fallback applies only at connect-time, not mid-stream.**

**Tool construction** (`buildToolSet`) is the bridge to the `ai` SDK's `tool()`:

- **Client tools** (`LlmStreamTool = { description, inputSchema (Zod), execute }`) are
  wrapped in `tool()`, with `onToolCallStart`/`onToolCallEnd` instrumentation.
- **Native provider tools** — `NativeWebSearchSpec` maps to Anthropic's server-side
  `webSearch_20250305`. No `execute`; events surface from the stream via `onChunk`.
  Configured only when the resolved model is a Claude model; skipped otherwise.

## Surfaces

| Surface                                     | Controller / endpoints                                                                                                         | Method                                                                             | Models                                                            | Tools                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Campaign chat** (candidate assistant)     | `src/campaigns/ai/chat/aiChat.controller.ts` — `POST /campaigns/ai/chat`, `…/chat/stream` (SSE), CRUD threads, `…/feedback`    | `chatCompletion` + `streamChatCompletion` + `jsonCompletion`                       | `getChatModelChain()` (`claude-sonnet-4-6` default)               | none                                                                                                                                              |
| **Campaign content generation**             | `src/campaigns/ai/content/aiContent.controller.ts` — `POST /campaigns/ai`, rename, delete                                      | `chatCompletion` (runs async in the SQS consumer, `QueueType.GENERATE_AI_CONTENT`) | `claude-sonnet-4-6` default chain                                 | none                                                                                                                                              |
| **Briefing chat** (elected officials)       | `src/chats/briefing-chats/controllers/briefing-chats.controller.ts` — `POST /briefing-chats`, `…/:annotationId/messages` (SSE) | `streamChatCompletion` via `ChatStreamService`                                     | `BRIEFING_CHAT_MODELS = ['claude-sonnet-4-6','claude-opus-4-7']`  | `get_artifacts`, `web_search`, `district_insights`, `list_district_topics`, `get_my_notes`                                                        |
| **Chief of Staff chat** (elected officials) | `src/chats/general/controllers/general-chats.controller.ts` — `POST /v1/chats`, `…/:conversationId/messages` (SSE)             | `streamChatCompletion` via `ChatStreamService`                                     | `CHIEF_OF_STAFF_MODELS = ['claude-sonnet-4-6','claude-opus-4-7']` | `crud_priorities`, `list_briefings`, `get_briefing`, `web_search`, `query_constituent_data`, `describe_constituent_data`, `read_community_issues` |
| **Ordinance flow chat** (elected officials) | same general-chats controller, `scope=ordinance_flow` — one conversation per (ordinance, step)                                 | `streamChatCompletion` via `ChatStreamService` (`maxSteps` 8)                      | `ORDINANCE_FLOW_MODELS = ['claude-sonnet-4-6','claude-opus-4-7']` | per step — see the ordinance flow paragraph below (research tools + `present_*` display tools, clarify widgets, `web_search`)                     |

Other non-chat **generation** surfaces (not interactive chat) live elsewhere and
split across two providers. Some go through `LlmService` (Anthropic) non-streaming
methods — `src/polls/` (poll bias analysis), `src/topIssues/`, and the
`src/elections/` race-location extraction. Others go through a separate
`GeminiService` (`src/vendors/google/`) for Google-Search-grounded generation —
`src/campaignStory/` (rewrite candidate story), `src/campaignStrategy/`
(community events), and `src/onboarding/localNews.service.ts`.

### Streaming mechanics (the `src/chats/` path)

`src/chats/services/chatStream.service.ts` adapts `LlmService` streaming to HTTP SSE:
it appends the user message, loads up to `MAX_CHAT_HISTORY_MESSAGES = 40` prior
messages, calls `streamChatCompletion`, and pumps deltas/tool events through a
backpressure-bounded `ChunkQueue` (max 256). Controllers write `data: <JSON>\n\n`
frames with a 300s timeout and an `AbortController` on client disconnect. Error codes:
`conversation_not_found`, `rate_limited`, `upstream_unavailable`, `aborted`,
`internal`.

### The chat-scope abstraction

`src/chats/general/` is the architecture meant to generalize interactive chat.
`ChatScopeHandler<TContext>` declares `scope`, `isSensitive`, `models`, and
`resolveConversation / loadContext / buildSystemPrompt / buildTools`. Handlers
register through the `CHAT_SCOPE_HANDLERS` DI token — adding a scope needs no
controller/service change. `ChatScopeRegistry` **fails closed**: any `isSensitive`
scope must use only `claude`-routed models, so tool outputs never leave Anthropic.
Today **`chief_of_staff` and `ordinance_flow` are registered**;
`briefing_annotation` and `campaign_assistant` exist as `ChatScope` enum values
but briefing chat still runs through its own dedicated controller/service.
Handlers may also declare an optional `maxSteps` to raise the tool-loop step
budget (ordinance flow uses 8).

## Tools / function calling

The briefing, Chief of Staff, and ordinance flow surfaces register tools; campaign
chat registers none. All tools are the `LlmStreamTool` shape defined in
`src/llm/tools/`:

- **`query_constituent_data` / `describe_constituent_data`** — aggregate,
  district-scoped constituent opinion + demographics from the `serve_agent_voters`
  mart in **Databricks** (L2 voter rows + Haystaq modeled issue-support scores).
  Heavily guarded: AST validation (`node-sql-parser`), single aggregate-only SELECT,
  column allowlist, forbidden partisan columns, mandatory server-bound WHERE filters,
  and **cell-size suppression** (drops cells with COUNT < 100). This is the
  voter-data tool, and the reason its scope handler is `isSensitive`.
- **`district_insights` / `list_district_topics`** — the same Databricks/Haystaq
  aggregate model for briefing chats; `list_district_topics` is a static catalog so
  the model doesn't guess column names.
- **`query_databricks`** — generic read-only Databricks SELECT (write nodes blocked,
  1000-row cap).
- **`get_artifacts`** / **`get_my_notes`** — read briefing source docs/links and the
  user's own annotations.
- **`crud_priorities`** — the only **write** tool; CRUD on durable COS `Priority`
  records.
- **`web_search`** — Anthropic native `webSearch_20250305`, `maxUses: 5`.

The **ordinance flow** scope (`src/chats/general/ordinance-flow/`) registers
per-step tool sets: `read_ordinance`, `get_code_source` (verified code-source
lookup), `save_note`, and native `web_search` on every step; `offer_next_step`
on all steps except `draft`; `ask_clarify_question` / `save_answer` /
`save_synthesis` on the clarify step; `fetch_url` (SSRF-guarded page fetch →
markdown) / `save_existing_law` / `brave_search` on the current_law step.
`brave_search` (Brave Web Search, gated on `BRAVE_API_KEY`) returns fetchable
result URLs so the model can find a server-rendered copy of a chapter when
`fetch_url` comes back blank — Municode and other browser-rendered code sites
do this. Its handler raises `maxSteps` to 8 — a current_law turn chains
`get_code_source` + several `fetch_url` calls + `save_existing_law`, and the
default 5 cuts research off mid-chain.

Each step also gets the `present_*` display tools its page renders: the model
passes the finding as the tool's args (which persist as the tool segment the
webapp widget replays from), and `execute` persists the artifact subset where a
column exists. `present_authority_finding` (authority step, persists
`authority`); `present_current_law_summary` + `present_legislative_history`
(current_law step, display-only); `present_comparables` (comparables step,
persists `comparables`). Payload shapes are the `Ordinance*Schema` /
`OrdinancePresentComparablesSchema` contracts consumed by `stepWidgets.tsx` in
gp-webapp. The draft step has no `present_*` tool yet.

COS-specific tool ports live in `src/chats/general/chief-of-staff/services/`
(`list_briefings`/`get_briefing`, `read_community_issues`). Tool-calling chat is
always **streaming** (multi-step `stepCountIs`); the non-streaming `toolCompletion`
exists but isn't used by these surfaces.

## Chat persistence (Prisma)

Two storage shapes:

- **Serve chats (briefing + COS)** — `ChatConversation` (`chatConversation.prisma`:
  `ownerUserId`, `scope`, `organizationSlug`, `title`, `anchor`, soft-delete),
  `ChatMessage` (`role`, `content`, `clientMessageId` for idempotency, immutable), and
  `ChatMessageSegment` (`ordinal` + `kind ∈ {text, tool}`, created only when a turn
  used tools, for rendering tool "pills"). A briefing chat is an `Annotation(kind=chat)`
  pointing at a `ChatConversation` — which is why briefing-chat endpoints key on
  `:annotationId`. Stores: `chatStore.prisma.ts`, `generalChatStore.prisma.ts`.
- **Campaign chat** — `AiChat` (`aiChat.prisma`): one `data` JSONB blob holds
  the whole message array + feedback. No normalized message tables.

## Prompt management

Two prompt sources:

- **Serve chats (briefing + COS): in-code, assembled from composable blocks,
  deterministic.** Briefing: `src/chats/briefing-chats/services/systemPromptBuilder.ts`
  (~11 blocks, ending with the `<briefing>…</briefing>` artifact). COS:
  `src/chats/general/chief-of-staff/services/chiefOfStaffPrompt.ts`
  (`buildChiefOfStaffSystemPrompt` — "You are the user's Chief of Staff. The user is
  the elected official you serve, NOT you." plus injected `<office_context>`,
  `<priorities>`, optional `<anchored_issue>`).
- **Campaign chat/content: prompts come from Contentful**, synced into the
  Postgres `Content` table (`ContentType.aiChatPrompt` etc.). `content.service.ts`
  selects the entry, then `src/ai/services/promptReplace.service.ts` substitutes
  `[[token]]` placeholders with campaign data + live race metrics. User input is run
  through `sanitizeUntrustedContent` to strip prompt-injection delimiters.

## Crossover with the background system

This is the one seam between the two halves of CAP, and it is **one-directional and
read-only**: interactive chats **read** the artifacts background agents **produce**.

- **Briefing chat** loads the briefing artifact from **S3** (`briefingArtifactsProvider.ts`
  - `briefingArtifactCache.service.ts`, `S3Service.getFile`, 50-entry/15-min LRU,
    1 MB cap), embeds it in the system prompt, and surfaces it via `get_artifacts`.
- **Chief of Staff** reads the **cached `MeetingBriefing.artifact` JSONB directly
  from Postgres** (no S3 fetch) via `chiefOfStaffBriefings.service.ts`, exposed as
  `list_briefings`/`get_briefing`. `briefingSanitizer.ts` enforces a strict field
  allowlist so internal scaffolding (run metadata, raw research, `hs_`/`l2_` column
  names) never reaches the model. COS also reads background-refreshed `CommunityIssue`
  records via `read_community_issues`.

The interactive model does **not** trigger background runs — dispatch is owned by the
product callers of `ExperimentRunsService.dispatchRun`, not the chat handlers.

## The eval gap

Unlike the background system (which has a structured two-axis eval and human
`ArtifactReview` verdicts), the interactive model has **no comprehensive automated
eval**. This is a known, growing area of investment. What exists today:

- **Exactly one LLM eval file:** `src/chats/briefing-chats/evals/briefingChatPrompt.eval.test.ts`
  — a behavioral eval (real Claude call, `temperature: 0`) with ~12 assertion cases
  (grounding, role framing, guardrail decline, prompt-injection). It is **gated by
  `RUN_LLM_EVALS=1` and `describe.skip`'d by default — it never runs in CI.**
- The harness (`src/chats/evals/runEval.ts`) is a **substring/regex matcher**
  (`mustContain`/`mustNotContain`/`custom`) — **no LLM-as-judge, no rubric scoring,
  no golden datasets.**
- **Chief of Staff has no eval file at all** — only unit/integration tests of the
  prompt builder and plumbing. `*.integration.test.ts` files assert deterministic
  prompt _composition_ (string-contains on rendered blocks), not model behavior;
  these do run in CI.
- The campaign chat's only quality signal is the `POST /:threadId/feedback`
  thumbs-up/down piped to Slack.
- **Braintrust** (`src/vendors/braintrust/`) wraps the chat stream
  (`braintrust.traced('briefing-chat-stream', …)`) and other AI surfaces, but this is
  **observability/tracing, not evaluation.**

For the background-side eval methodology that could inform a future interactive eval,
see [`cap-background-agents.md`](cap-background-agents.md) (Part 3) and
`packages/runbooks/books/pmf-eval-system.md`.

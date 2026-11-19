# src/decisionModels/

A provider-agnostic client for decision models: typed yes/no, choice and
score judgments over a piece of text, each answered with probabilities.
`DecisionModelService.decide({ input, questions })` takes a map of questions
keyed by `[A-Za-z0-9_-]{1,64}` and returns, per key, `{ type, value,
probabilities, confidence? }`, plus `usage`, `model`, `provider` and
`costUsd`. Product callers never name a provider; a caller that holds its own key,
such as a judge arm, passes `credentials: { provider, apiKey }` as the
second argument and skips the env.

Kept out of `src/llm/` on purpose: the judge guard maps that folder to every
agent, and nothing here is an agent.

## Providers

`DECISION_MODEL_PROVIDER` picks one per call (read at call time). Blank means
`gemini`; any other unknown value throws rather than falling back, so a typo
cannot send text to a vendor nobody chose. `DECISION_MODEL_ID` overrides the
provider's default model.

| Provider                 | Endpoint                                                                    | Key                | Default model       |
| ------------------------ | --------------------------------------------------------------------------- | ------------------ | ------------------- |
| `gemini`                 | `POST generativelanguage.googleapis.com/v1beta/decisions`, `x-goog-api-key` | `GEMINI_API_KEY`   | `gemini-decision-1` |
| `typesafe` (Jev, direct) | `POST api.typesafe.ai/v1/systemone`, `Authorization: Bearer`                | `TYPESAFE_API_KEY` | `jev-latest`        |

Both speak the same question map (`noul` / `choice` / `score`, wire shapes in
`schemas/decisionWire.schema.ts`); TypeSafe calls the input `state`. Gemini is
plain HTTP because `@google/genai` 2.10.0 has no decisions API. Every response
is Zod-validated, and every question asked must come back as its own type.

`TYPESAFE_API_KEY` is in no secret store. Wiring it to a deploy means adding
it to `deploy/gp-api-secret-keys.ts` and the admin handoff in root
`docs/secrets.md`, and gp-api's deploy stops on a declared key the secret
lacks, so the value lands first.

Not built, but the next providers to add here: the Vercel AI Gateway's
`/v1/decisions` (an array of named questions, `predicate` for yes/no, and
`providerOptions.gateway.zeroDataRetention`), and OpenJev on Databricks, the
tightest path for restricted data if the people-data principal may call it.

## Errors

Every failure is a `DecisionModelError` (a `BadGatewayException`) with a
`reason`: `not_configured` (key unset, no call made), `unauthorized` (401,
403, or Gemini's `API_KEY_INVALID` 400), `input_rejected` (any other 400;
safety blocks can arrive this way), `safety_block` (a 2xx with
`prompt_feedback.block_reason`), `provider_error` (other non-2xx, network,
timeout) or `invalid_response`. It carries status codes and provider error
codes only, never the provider's message, which could quote the input.

## Cost

`costUsd` is input tokens times
`DECISION_MODEL_INPUT_USD_PER_MILLION_TOKENS[model]` ($0.10 per million for
`gemini-decision-1`). A model missing from that table prices as `null`.

## Callers

| Caller                                             | What                                                                                                                                                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `outreach/util/replyIntent.util.ts`                | Reply intent (opt-out, civic panel join and leave), regex floor for opt-out, questions worded per channel. Shadow only, behind `REPLY_INTENT_DECISION_SHADOW`; `outreach/docs/text-delivery.md` |
| `chats/evals/judge/labeled/replyIntent.adapter.ts` | The Universal Judge's `reply_intent` arm. A spending arm calls Gemini with `JUDGE_GEMINI_API_KEY`; judge README "Labeled cases"                                                                 |

A change here auto-selects `reply_intent` for `/judge`
(`.github/scripts/judge-path-floor.sh`).

Tests: `services/decisionModel.service.test.ts` spies on `fetch` with the
bodies in `fixtures/` (invented text only).

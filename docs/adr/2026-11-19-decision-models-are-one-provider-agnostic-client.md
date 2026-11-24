---
title: Decision models are called through one provider-agnostic client in gp-api, chosen by env
status: active
decided_by: [agent]
date: 2026-11-19
code: ['#3909']
scope:
  - packages/gp-api/src/decisionModels/**
supersedes: []
superseded_by:
---

# Decision models are called through one provider-agnostic client in gp-api, chosen by env

## Decision

Typed yes/no, choice and score judgments over text go through
`DecisionModelService.decide` in `src/decisionModels/`. Callers ask
questions and read answers with probabilities. They never name a vendor:
`DECISION_MODEL_PROVIDER` picks Gemini Decision 1 (the default) or TypeSafe's
Jev, and an unknown value throws rather than falling back. Each provider is
plain HTTP with a Zod-validated response, and every failure is one typed
`DecisionModelError`. The module sits outside `src/llm/`.

## Context

Reply intent (opt-out, civic panel join and leave) is read by regex today,
and we want to measure a decision model against it, in ingest shadow and in
an expected-result eval suite (`outreach/util/replyIntent.eval.ts`, run on
either reader), before anything depends on it. Gemini's
key already exists; Jev needs a key no environment has; the Vercel AI Gateway
and Databricks OpenJev are both plausible later. Which vendor may receive
real reply text is a product decision that has not been made, so swapping
one must not touch callers. `@google/genai` 2.10.0 has no decisions API.

## Alternatives rejected

- **Call Gemini directly from the reply classifier.** Swapping to Jev or a
  gateway would mean rewriting every caller, and the vendor choice is still
  open.
- **Put the client under `src/llm/`.** The judge guard's code map sends a
  change there to every agent suite, so each change here would run all of
  them.
- **Use `@google/genai` or the `ai` SDK.** Neither has a decisions surface at
  the installed versions, and TypeSafe has no SDK in the repo.
- **Fall back to a default provider on a bad config value.** A typo would
  quietly send text to a vendor nobody chose.

## Revisit if

A gateway that fronts several decision models with zero data retention
becomes the only path we use, at which point the client may collapse to that
one provider.

---
title: Display-only chat cards are kinds of one present_card tool, catalog in contracts
status: active
decided_by: [swain]
date: 2026-10-29
code: ['#TBD']
scope:
  - packages/contracts/src/chats/PresentCard.schema.ts
  - packages/gp-api/src/chats/general/chat-tools/presentCard.tool.ts
  - packages/gp-api/src/chats/general/**
  - packages/gp-api/src/chats/services/chatStream.service.ts
  - packages/gp-webapp/app/dashboard/shared/agent-chat/**
supersedes: []
superseded_by:
---

# Display-only chat cards are kinds of one present_card tool, catalog in contracts

## Decision

A chat card whose tool would only acknowledge its arguments is a `kind` of one
`present_card` tool. Its input is `{ card }`, where `card` is a zod
discriminated union keyed by `kind` defined once in `@goodparty_org/contracts`
(`PresentCardSchema`). gp-api offers each surface a subset of kinds and writes
their prompt text from the catalog. The webapp renders every kind through one
map keyed by kind, typed so a missing kind fails the build. A new display card
is a new kind plus a component, two files, where it used to be about nine
touch points across contracts, gp-api and the webapp.

Swain chose the home-grown catalog over a generative UI library and over
per-card tools. Which tools moved was the agent's call: a tool moves when it
is a pure presenter, meaning its execute only acknowledges and its args are
the card, by tool name across every surface that registers it. A tool whose
execute does real work stays a tool: it persists, gates on what it reads,
validates beyond its schema, or drives a control. So
`present_authority_finding` and `present_comparables` stay tools, because the
ordinance flow's versions persist, even though the priority flow registers
acknowledge-only versions of them.

## Context

Every display card was its own tool: a contracts schema, a tool builder, a
registration and prompt rule per handler, the `present_` prefix for history
replay, a webapp component, a registry entry per surface, a pill label and
tests. We built the same nine-component catalog through one tool with each of
three libraries (POC PRs #3362, #3363, #3364). The model wrote a valid payload
every time it used the tool in all three. Every miss was routing, and in all
three a new component cost two files. The library did not decide the cost;
one tool with a catalog did.

Anthropic needs a tool's input to be a top-level object, so the union sits
under `card`. Persisted segments keep their old tool names forever, so the
webapp renders the old names and gp-api replays them to the model as
`present_card` calls.

## Alternatives rejected

- **Per-card tools (the status quo).** About nine touch points per card and
  three places tool names were restated.
- **json-render.** The strongest library, but 0.x with renames, its prop
  validation is a no-op for multi-component catalogs, its stock prompt invents
  sample data, and it ships a second zod copy. We would own a validator and a
  prompt template anyway.
- **OpenUI.** Best streaming story, but its 1.0 was days old, install
  telemetry is on by default, and its advertised zod range does not work.
- **A2UI.** About five times the bundle and the prompt, its own zod 3, a
  pinned DOMPurify with advisories, and monthly breaking protocol changes.

## Revisit if

We want the model to compose layouts we did not pre-build, or to stream a
card's fields as they generate. json-render is the first library to re-check.

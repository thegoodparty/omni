---
title: Agents reach Amplitude through the amp CLI on laptops and REST keys on Delegate
status: active
decided_by: [swain]
date: 2026-11-04
code: ['#3582']
scope:
  - .claude/skills/amplitude-flag/**
  - .claude/skills/event-metadata/**
  - packages/gp-ai/autopilot/agent/amplitude_flags.py
  - packages/gp-ai/infrastructure/modules/autopilot-agent-fargate/main.tf
  - docs/mcp.md
supersedes: []
superseded_by:
---

# Agents reach Amplitude through the amp CLI on laptops and REST keys on Delegate

## Decision

Developers' agents drive Amplitude flags with the `amp` CLI. Delegate and other
headless agents call the Experiment Management API and the Taxonomy API with
long-lived keys held as env vars (`AMPLITUDE_MANAGEMENT_API_KEY`, and an
api key and secret key pair per project). One skill serves both: it detects
which access the session has. Every new flag is attached to the gp-api and
gp-marketing deployments in both projects, and releases, prod included, run
through the skill rather than the Amplitude UI.

The Amplitude MCP stays only for event taxonomy tags and display names on
laptops, because `amp` can't write them and project secret keys don't go on
laptops (`docs/secrets.md`). That part was settled during implementation
([agent]).

## Context

The MCP could set a flag's rollout only at create time, so every prod release
was a manual UI step, and its OAuth login can't run headless. Amplitude
personal access tokens, which `amp` uses, are capped at 30 days and are
read-only, so Delegate can't use `amp`.

## Alternatives rejected

- Keep the MCP for everything: no rollout changes, no headless use.
- `amp` with a personal access token on Delegate: expires and can't write.
- Taxonomy API keys on laptops: puts project secret keys on every machine.

## Revisit if

`amp` gains tag and display-name writes (drop the MCP), or Amplitude issues
long-lived write tokens that `amp` accepts (one path for both).

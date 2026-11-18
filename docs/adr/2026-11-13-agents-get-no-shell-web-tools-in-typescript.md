---
title: Agents get no shell, and web access is TypeScript tools in gp-api
status: active
decided_by: [swain]
date: 2026-11-13
code: ['#3836']
scope:
  - packages/gp-api/src/agents/**
  - packages/gp-ai/broker/**
supersedes: []
superseded_by:
---

# Agents get no shell, and web access is TypeScript tools in gp-api

## Decision

The Python broker goes away with the PMF Engine. Agents in gp-api get no
shell, no bash and no file system, so they need no quarantine. Tools hold
the credentials, never the model.

Web access is TypeScript tools: a web search (Brave, per
`2026-11-17-agent-web-search-is-brave-in-typescript.md`), a plain HTTP page
fetch that applies the private-address guard on every redirect hop, a link
check, and document reading (added, like the browser, when an agent needs
it). A page that needs a real browser is rendered in Amazon Bedrock
AgentCore Browser over the Chrome DevTools Protocol, added only when an
agent shows it needs it. No Chromium inside the gp-api image. For judge
runs, the fetch tools replay the pages the broker recorded.

## Context

Background agents today have Bash, Write, Edit, Glob and Grep, which is why
they run quarantined and the broker is their only way out: it holds every
credential, renders every fetch in Playwright Chromium, and records pages
for the universal judge (`docs/cap-background-agents.md`). Because it
renders everything, nothing shows which pages need a browser. Fetched text
is untrusted either way; with no shell, the exposure is the same as chat
agents have today.

## Alternatives rejected

- **Keep the broker as an egress proxy for gp-api agents.** A second
  service, in Python, for a boundary that exists because agents had a shell.
- **Chromium in the gp-api image.** Hundreds of MB of memory per render
  inside API tasks.
- **Firecrawl.** A scraping vendor that decides how each site is extracted,
  for a monthly fee.
- **Browser controls for the model on every agent** (Playwright MCP's
  navigate, click, type). Many more steps and tokens per page, and harder
  judge replay. Still possible per agent later.

## Revisit if

An agent needs to run code, which would need a sandbox again.

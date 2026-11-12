---
title: Vercel settings are managed by a Pulumi stack in omni, not the dashboard
status: active
decided_by: [swain]
date: 2026-11-12
code: ['#3772']
scope:
  - packages/vercel-config/**
  - .github/workflows/vercel-config.yml
  - .github/workflows/vercel-config-diff.yml
supersedes: []
superseded_by:
---

# Vercel settings are managed by a Pulumi stack in omni, not the dashboard

## Decision

`packages/vercel-config` is a Pulumi stack (`@pulumiverse/vercel`) with one
`prod` stack in the shared `s3://goodparty-iac-state` backend. It owns gp-ui's
preview protection, the `dev.goodparty.org` protection exception, deployment
retention and firewall config. Pull requests get a `pulumi preview` comment;
a push to `main` applies it from the `production` environment with its own
Vercel token. Existing settings are adopted with `import` and `protect: true`,
and the project itself is only looked up, never managed.

## Context

Every Vercel setting was click-ops. In November 2026 bots scraping public
preview URLs drove Vercel spend up about 4x, and the budget alerts reached
only the owner's email. Fixing that means protection, firewall and retention
changes that should be reviewed and reproducible, like the rest of our infra.

## Alternatives rejected

- **Keep the dashboard.** Nothing reviews a change, and nothing records what
  the settings were before an incident.
- **Manage `vercel.Project`.** It would own build settings and env vars, which
  the deploy action and other people already change.
- **Manage the automation bypass and team webhooks.** The bypass's import ID is
  its secret, and a webhook's signing secret would land in state the PR diff
  role can read.

## Revisit if

Vercel config moves to a different IaC tool for the rest of omni, or another
project's settings need the same treatment (add them to this stack).

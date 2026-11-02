---
title: PR previews deploy with a Vercel token that cannot deploy production
status: active
decided_by: [swain]
date: 2026-11-02
code: ['#PRNUM']
scope:
  - .github/actions/vercel-deploy/**
  - .github/workflows/gp-webapp.yml
  - .github/workflows/gp-admin.yml
  - .github/workflows/candidate-sites.yml
  - .github/workflows/pr-preview-comment.yml
supersedes: []
superseded_by:
---

# PR previews deploy with a Vercel token that cannot deploy production

## Decision

Pull request previews deploy with `VERCEL_PREVIEW_TOKEN`, owned by the
`vercel-preview-user@goodparty.org` Vercel account with the Developer role.
Developer can deploy previews but cannot deploy, promote or roll back
production. PR previews therefore have no stable per-PR alias, because
Developer cannot assign one: each deploy writes its generated URL into the
PR's preview comment instead. The production token lives only in the
`production` GitHub environment, which only `main` can use.

## Context

Any branch in omni can change a workflow and read every secret its pull
request runs can read. Moving the production token behind `main` (APP-7)
protects nothing if the preview token can also deploy production. A Vercel
token carries its owner's team role, and no extended permission lets a
Developer assign aliases, so a stable per-PR alias and a preview token that
cannot reach production are mutually exclusive.

## Alternatives rejected

- **Member-role preview account.** Keeps per-PR aliases, but Member can deploy
  production, so every pull request can.
- **A trusted workflow that assigns aliases.** A `pull_request_target` job,
  running only `main`'s code with a Member token in a `main`-locked
  environment, could alias each preview after it deploys. More machinery, and
  it keeps a production-capable token in GitHub for a convenience.
- **Vercel's automatic branch URLs.** Only Git-linked projects get them; ours
  deploy through the CLI with no Git integration.

## Revisit if

Vercel adds a permission that allows aliasing without production deploys, or
the apps move to Vercel's Git integration.

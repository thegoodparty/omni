---
title: Machine callers authenticate to gp-api with their platform's OIDC token
status: active
decided_by: [swain]
date: 2026-10-29
code: ['#3395', '#3421']
scope:
  - packages/gp-api/src/authentication/**
  - packages/gp-api/deploy/index.ts
supersedes:
  - 2026-10-29-vercel-callers-authenticate-with-oidc.md
superseded_by:
---

# Machine callers authenticate to gp-api with their platform's OIDC token

## Decision

A machine that reads gp-api's service-read routes authenticates with the
short-lived OIDC token its platform signs for it, sent as
`Authorization: Bearer`. Server code on Vercel (gp-marketing,
candidate-sites) sends the deployment's Vercel OIDC token, checked as before:
Vercel's JWKS and issuer, audience `https://vercel.com/good-party`, and
`project_id:environment` in `VERCEL_OIDC_ALLOWED_PROJECTS`. A GitHub Actions
workflow sends a GitHub OIDC token requested with audience `gp-api`. gp-api
verifies it against GitHub's JWKS (issuer
`https://token.actions.githubusercontent.com`, RS256), then requires the
`repository` and `repository_id` to match a pair pinned in code and
`job_workflow_ref` to match an entry of `GITHUB_OIDC_ALLOWED_WORKFLOWS`
(`<owner>/<repo>/<path>@<ref>`, `<ref>` may be `*`), set per gp-api
environment in `deploy/index.ts`. Either token is a service reader, never a
full M2M caller, and no other token is a service reader.

## Context

Vercel callers moved to Vercel OIDC first. The last Clerk service reader was
gp-marketing's hourly `generate-people-sitemaps` GitHub workflow, which
minted a Clerk M2M token from the gp-marketing machine secret stored in
GitHub. GitHub signs a token per workflow run naming the repository, its
numeric id and the exact workflow file and ref, so no secret has to be
stored, and moving it lets Clerk service auth be deleted. The repository id
is pinned because a repository name can be freed and re-registered by
someone else; the id cannot.

## Alternatives rejected

- Keep the Clerk M2M token in the workflow. A stored machine secret, and the
  only thing keeping the Clerk service-read path alive.
- Allowlist by repository only. Any workflow or branch in gp-marketing could
  then read as a service; the workflow file and ref narrow it to the job
  that needs it.
- Pin the repository id in env config. It never changes and is not secret, so
  a per-environment copy would only be one more value to keep in sync.

## Revisit if

A caller runs somewhere that issues no OIDC token, which would need its own
credential.

---
title: Machine callers authenticate to gp-api with their platform's OIDC token, and gp-admin's is a full M2M caller
status: active
decided_by: [swain]
date: 2026-10-29
code: ['#3395', '#3421', '#3436']
scope:
  - packages/gp-api/src/authentication/**
  - packages/gp-api/deploy/index.ts
supersedes:
  - 2026-10-29-machine-callers-authenticate-with-platform-oidc.md
superseded_by:
---

# Machine callers authenticate to gp-api with their platform's OIDC token, and gp-admin's is a full M2M caller

## Decision

A machine that calls gp-api authenticates with the short-lived OIDC token its
platform signs for it, sent as `Authorization: Bearer`. Server code on Vercel
sends the deployment's Vercel OIDC token: gp-api checks Vercel's JWKS and
issuer, audience `https://vercel.com/good-party`, and the token's
`project_id:environment` against two separate allowlists.
`VERCEL_OIDC_ADMIN_PROJECTS` makes the caller a full M2M caller, the same
privilege as a Clerk `mt_` token (`request.m2mToken`, `source: 'vercel-oidc'`,
subject `vercel:<project>:<environment>`). `VERCEL_OIDC_ALLOWED_PROJECTS`
makes it a service reader only. The admin list is checked first and on its
own, so a reader entry can never grant admin. Prod's admin list holds only
gp-admin's `production` deployment; dev and preview also hold its `preview`
and `development`. A GitHub Actions workflow sends a GitHub OIDC token with
audience `gp-api`, verified against GitHub's JWKS, a `repository` and
`repository_id` pair pinned in code, and `job_workflow_ref` in
`GITHUB_OIDC_ALLOWED_WORKFLOWS`; it is a service reader only.

## Context

gp-admin calls gp-api with Clerk `mt_` tokens minted from per-environment
machine secrets. Those secrets are set for Vercel's Production, Preview and
Development environments, so every gp-admin preview deployment and every
`vercel env pull` holds full prod admin. Vercel signs each deployment a token
naming its project and environment, so prod can accept gp-admin's production
deployment and nothing else. gp-admin is one production deployment that calls
both dev and prod gp-api (the Clerk org switch picks which), which is why the
dev list includes `production` too. The repository id is pinned for GitHub
because a repository name can be freed and re-registered; the id cannot.

## Alternatives rejected

- One Vercel allowlist with a tier suffix per entry. A typo or copy-paste
  between envs could quietly promote a reader to admin; two lists keep the
  privilege boundary in the variable name.
- Scope gp-admin's Clerk machine secrets to Vercel Production only. The
  secret is still long-lived and copyable, and Development (`vercel env
pull`) is where local work needs a credential.
- Keep the Clerk M2M token in the gp-marketing sitemap workflow. A stored
  machine secret, and the only thing keeping the Clerk service-read path
  alive.
- Allowlist GitHub callers by repository only. Any workflow or branch could
  then read as a service; the workflow file and ref narrow it to one job.

## Revisit if

A caller runs somewhere that issues no OIDC token, or gp-admin needs a
non-production deployment to administer prod.

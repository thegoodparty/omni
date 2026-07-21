# Omni — GoodParty product monorepo

Omni is GoodParty.org's product code in one npm-workspaces monorepo: the candidate
web app, the API monolith, two data microservices, the admin console, the candidate
sites, and the shared SDK/contracts. One repo means agents and humans share one
context, deploys are unified, and shared code is de-duplicated.

**This repo is built to be worked through coding agents.** Almost every change here
is made by an engineer driving an agent. So every doc is an agent-context surface.
Optimize for high signal, and read the _nearest_ relevant doc rather than loading
everything.

## How to use this file

This is the map, not the manual. It carries repo-wide conventions and points you at
the right detailed doc. The detail lives in per-package `CLAUDE.md` files (loaded on
demand when you open files in that package) and in `docs/`. Follow the pointers.

## Packages

| Path                       | What                                                              | Stack             | Port |
| -------------------------- | ----------------------------------------------------------------- | ----------------- | ---- |
| `packages/gp-api`          | API monolith (auth, campaigns, payments, AI)                      | NestJS + Fastify  | 3000 |
| `packages/gp-webapp`       | Product app for candidates & elected officials                    | Next.js 16        | 4000 |
| `packages/prototypes`      | Public backend-free UI prototyping surface                        | Next.js           | 4002 |
| `packages/election-api`    | Election/race/candidacy data microservice                         | NestJS + Fastify  | 3001 |
| `packages/people-api`      | Voter/people data microservice (L2 records)                       | NestJS + Fastify  | 3002 |
| `packages/gp-admin`        | Internal staff admin console (uses the SDK)                       | Next.js 16        | 3500 |
| `packages/candidate-sites` | Per-candidate static sites                                        | Next.js           | 4001 |
| `packages/styleguide`      | `@goodparty_org/styleguide` — shared design system (Radix/shadcn) | TypeScript        | —    |
| `packages/gp-sdk`          | `@goodparty_org/sdk` — typed API client                           | TypeScript        | —    |
| `packages/contracts`       | `@goodparty_org/contracts` — Zod schemas/types                    | TypeScript        | —    |
| `packages/runbooks`        | Agent runbooks, slash commands, PMF experiments                   | Markdown + Python | —    |

## Where to look (read the nearest doc first)

| You're doing                           | Read                                          |
| -------------------------------------- | --------------------------------------------- |
| **Working inside package X**           | **`packages/X/CLAUDE.md`** (then nested ones) |
| Understanding the system / service map | `docs/architecture.md`                        |
| Our AI agent platform (CAP) — overview | `docs/cap.md`                                 |
| Background agents / PMF Engine / evals | `docs/cap-background-agents.md`               |
| Interactive AI chat (the `ai` SDK)     | `docs/cap-interactive-agents.md`              |
| Setting up / running locally           | `docs/development.md`                         |
| Writing or fixing a test               | `docs/testing.md`                             |
| Deploys, branches, CI                  | `docs/deployment.md`                          |
| Debugging a prod issue / incident      | `docs/observability.md`                       |
| The CRM (contacts) — flows, debugging  | `packages/gp-api/src/contacts/CLAUDE.md`      |
| Which MCP tools exist + their env vars | `docs/mcp.md`                                 |
| Querying analytics data / Databricks   | `docs/databricks.md`                          |
| AI code-review rule files              | `ai-rules/` (git submodule)                   |

`packages/gp-api/CLAUDE.md` is the gold-standard for nested-doc style — pointer
tables and terse, high-signal sections. Each app and most feature folders carry one.

## Progressive disclosure — don't load everything

Top-level CLAUDE.md files load at launch; nested ones load only when you open files
in their directory. So: when you start work in an area, open its nearest `CLAUDE.md`
and follow its pointers. Don't try to hold the whole monorepo in context to make one
change. Read what the task touches.

## Keep docs current (required)

Docs here are living context, not archive. **When a change alters behavior,
architecture, or a convention, update the nearest relevant `CLAUDE.md` and/or
`docs/` file in the same change.** A PR that changes how something works and leaves
its doc stale is incomplete. Update docs in place; never leave them to rot.

## Repo-wide conventions

These apply across all TypeScript packages. Per-package docs add detail and may
tighten them (e.g. gp-api enforces an 80-char line width via `.cursor/rules/`); when
a nested rule conflicts with this list, the nested rule wins for that package.

`packages/runbooks` is the one polyglot exception: its `scripts/python/` is a
uv-managed Python project (its own `pyproject.toml`/`uv.lock`), independent of the
npm workspace graph. npm owns the TS packages; uv owns that subtree.

- **TypeScript style:** no semicolons, single quotes, trailing commas. Arrow
  functions over `function` declarations. No `any` (and avoid `unknown`) in new code.
- **Comments:** default to none. Add one only for a non-obvious WHY (a hidden
  constraint, a subtle invariant, a workaround). Never explain WHAT the code does.
  Never remove existing comments unless asked.
- **WET over premature DRY.** Don't extract a helper used in one place. Prefer the
  simplest approach first; don't over-engineer.
- **Validation:** Zod everywhere. API responses validated at runtime via response
  schemas; never `.passthrough()` input schemas.
- **Services:** Prisma-backed services extend `createPrismaBase(MODELS.ModelName)`
  (gp-api, people-api, election-api).
- **Contracts are the cross-service source of truth.** Any shape that crosses a
  service boundary (S2S payloads, SQS messages, webhook bodies) lives in
  `@goodparty_org/contracts`. Change the contract in the _same_ PR as the
  producer/consumer — see `docs/architecture.md`.
- **Tests:** Vitest, files named `*.test.ts` (never Jest, never `.spec.ts`). For
  code behind an HTTP route, test through the API/test harness, not via direct
  instantiation with mocks. See `docs/testing.md`.
- **Commits/PRs:** explain _why_, not _what_, in PR bodies. No "test plan" section.
  No `Co-Authored-By: Claude` and no "Created by Claude" footers. Never commit when
  lint/verify is failing for code you touched.

## Branches and deploys

`develop -> qa -> master` map to `dev / qa / prod` (people-api is `dev`/`prod`
only). Backends deploy via Docker/ECR/Pulumi to ECS Fargate; frontends deploy via
Vercel with deterministic PR-preview aliases. Detail in `docs/deployment.md`.

## Worktrees

This checkout is shared — other agents and sessions move `HEAD` underneath you. Do
git work (branches, commits, PRs) in a worktree, not the main checkout. The native
worktree tool places them in `.claude/worktrees/` (gitignored); if you create one by
hand, put it under `.worktrees/` and remove it with `git worktree remove`, never
`rm` — `rm` leaves git's worktree metadata dangling. After a worktree's PR merges,
run `git worktree prune`.

## Observability and debugging (use the MCPs)

When investigating a bug or incident, use the MCP tools rather than guessing.

- **Grafana MCP** for logs (Loki), metrics (Prometheus), and traces (Tempo).
  Datasource UIDs: Loki `grafanacloud-logs`, Tempo `grafanacloud-traces`,
  Prometheus `grafanacloud-prom`. Narrow logs with labels `service_name`
  (`gp-api` | `election-api` | `people-api`) and `deployment_environment_name`
  (`dev` | `qa` | `prod`), e.g.
  `{service_name="gp-api", deployment_environment_name="prod"}`.
- **Sentry MCP** for frontend errors. Org slug `goodparty`, region
  `https://us.sentry.io`.

Full label reference, example queries, and an incident playbook: `docs/observability.md`.

## MCP tools

Project-scoped MCP servers are configured in `.mcp.json` (Grafana, Sentry,
Playwright, ClickUp). They need a few environment variables set in your shell — see
`docs/mcp.md` for the list and what each server is for.

## Output rules

- Output only the modified code block; no full file rewrites, no setup guides, no
  explanations unless I ask for them.
- No setup guides or explanations unless I explicitly ask. Summaries are ok.
- Show changed lines plus minimal surrounding context.

## Model routing (my default policy)

- Default to Sonnet for normal coding tasks.
- Drop to Haiku for trivial edits, renames, and boilerplate.
- Escalate to Fable 5 for hard architecture, tricky debugging, and initial planning
  of epics, technical documents, and ticket creation/edits.
- Use Opus 4.8 as the fallback for those hard tasks when Fable is unavailable.
- If you think a task needs a more capable model than the current one, say so before
  proceeding.

## Style

- Be direct. Skip preambles and recaps.

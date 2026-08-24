# Omni — GoodParty product monorepo

Omni is GoodParty.org's product code in one npm-workspaces monorepo: the candidate
web app, the API monolith, a data microservice, the admin console, the candidate
sites, and the shared SDK/contracts. One repo means agents and humans share one
context, deploys are unified, and shared code is de-duplicated.

Voter/people data access used to be its own microservice (`packages/people-api`);
it was absorbed into `gp-api` (`src/peopleDb/`, direct people-db access) and the
package was removed from this repo. Nothing calls it any more; the people-api
ECS service and its Aurora cluster remain deployed but frozen, pending
teardown — see `packages/gp-api/src/peopleDb/AGENTS.md`.

**This repo is built to be worked through coding agents.** Almost every change here
is made by an engineer driving an agent. So every doc is an agent-context surface.
Optimize for high signal, and read the _nearest_ relevant doc rather than loading
everything.

## How to use this file

This is the map, not the manual. It carries repo-wide conventions and points you at
the right detailed doc. The detail lives in per-package `AGENTS.md` files (loaded on
demand when you open files in that package) and in `docs/`. Follow the pointers.

`AGENTS.md` is the single source of truth. Claude Code reads `CLAUDE.md`, so every
directory with an `AGENTS.md` also carries a `CLAUDE.md` symlink pointing at it —
one file, no drift. **Edit `AGENTS.md`, never `CLAUDE.md`.** The symlinks are created
and verified by `ai-rules/scripts/agents-md-sync.sh`, which CI runs on every PR.

## Packages

| Path                       | What                                                              | Stack             | Port |
| -------------------------- | ----------------------------------------------------------------- | ----------------- | ---- |
| `packages/gp-api`          | API monolith (auth, campaigns, payments, AI)                      | NestJS + Fastify  | 3000 |
| `packages/gp-webapp`       | Product app for candidates & elected officials                    | Next.js 16        | 4000 |
| `packages/prototypes`      | Public backend-free UI prototyping surface                        | Next.js           | 4002 |
| `packages/election-api`    | Election/race/candidacy data microservice                         | NestJS + Fastify  | 3001 |
| `packages/gp-ai`           | Python AI/data services + their Terraform                         | Python + uv       | —    |
| `packages/gp-admin`        | Internal staff admin console (uses the SDK)                       | Next.js 16        | 3500 |
| `packages/candidate-sites` | Per-candidate static sites                                        | Next.js           | 4001 |
| `packages/styleguide`      | `@goodparty_org/styleguide` — shared design system (Radix/shadcn) | TypeScript        | —    |
| `packages/gp-sdk`          | `@goodparty_org/sdk` — typed API client                           | TypeScript        | —    |
| `packages/contracts`       | `@goodparty_org/contracts` — Zod schemas/types                    | TypeScript        | —    |
| `packages/runbooks`        | Agent runbooks, slash commands, PMF experiments                   | Markdown + Python | —    |

## Where to look (read the nearest doc first)

| You're doing                           | Read                                          |
| -------------------------------------- | --------------------------------------------- |
| **Working inside package X**           | **`packages/X/AGENTS.md`** (then nested ones) |
| Understanding the system / service map | `docs/architecture.md`                        |
| Our AI agent platform (CAP) — overview | `docs/cap.md`                                 |
| Background agents / PMF Engine / evals | `docs/cap-background-agents.md`               |
| Interactive AI chat (the `ai` SDK)     | `docs/cap-interactive-agents.md`              |
| The Python AI services + their infra   | `packages/gp-ai/AGENTS.md`                    |
| Setting up / running locally           | `docs/development.md`                         |
| Writing or fixing a test               | `docs/testing.md`                             |
| Adding a scheduled / cron job          | `docs/scheduled-jobs.md`                      |
| Deploys, branches, CI                  | `docs/deployment.md`                          |
| Debugging a prod issue / incident      | `docs/observability.md`                       |
| The CRM (contacts) — flows, debugging  | `packages/gp-api/src/contacts/AGENTS.md`      |
| Which MCP tools exist + their env vars | `docs/mcp.md`                                 |
| Querying analytics data / Databricks   | `docs/databricks.md`                          |
| AI code-review rule files              | `ai-rules/` (git submodule)                   |

`packages/gp-api/AGENTS.md` is the gold-standard for nested-doc style — pointer
tables and terse, high-signal sections. Each app and most feature folders carry one.

## Progressive disclosure — don't load everything

Top-level agent docs load at launch; nested ones load only when you open files in
their directory. So: when you start work in an area, open its nearest `AGENTS.md`
and follow its pointers. Don't try to hold the whole monorepo in context to make one
change. Read what the task touches.

## Keep docs current (required)

Docs here are living context, not archive. **When a change alters behavior,
architecture, or a convention, update the nearest relevant `AGENTS.md` and/or
`docs/` file in the same change.** A PR that changes how something works and leaves
its doc stale is incomplete. Update _or delete_ in place; never leave them to rot.

**When a change removes something, delete its docs — don't rewrite them into a
tombstone.** No "X is retired" or "X no longer exists" sections. A reader who never
knew X existed should not have to learn about it in order to un-learn it, and git
history already keeps the story. The test: a change that simplifies the system
should leave this repo with _less_ documentation, not the same amount reworded. The
only prose a removal earns is a live, actionable leftover — a manual step someone
still has to take — and that goes in the PR body or a ticket, not a `CLAUDE.md`.

## Repo-wide conventions

These apply across all TypeScript packages. Per-package docs add detail and may
tighten them (e.g. gp-api enforces an 80-char line width via `.cursor/rules/`); when
a nested rule conflicts with this list, the nested rule wins for that package.

There are two polyglot exceptions: `packages/runbooks/scripts/python` and
`packages/gp-ai`. Each is a uv-managed Python project with its own
`pyproject.toml`/`uv.lock`, independent of the npm workspace graph. npm owns the TS
packages; uv owns those subtrees. `packages/gp-ai` has no `package.json`, so the
`packages/*` workspace glob skips it.

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
  (gp-api, election-api). gp-api's `src/peopleDb/` (the absorbed voter engine)
  mirrors this with `createPeopleDbBase(PEOPLE_MODELS.ModelName)` against a
  second, read-only Prisma client for people-db.
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

One long-lived branch, `main` (the default branch). Every PR targets `main`;
pushing to `main` runs the release train (`release.yml`): one serialized pipeline
that deploys every service to dev, runs the Playwright E2E against dev, then
promotes the same commit to prod. A burst of merges coalesces to the latest
commit. Prod is reached only by that train, never by a direct push. There is no
manual promotion and no `qa`/`master` branch.
Backends deploy via Docker/ECR/Pulumi to ECS Fargate; frontends deploy via Vercel
with deterministic PR-preview aliases. Detail in `docs/deployment.md`. The
deployed people-api service (`dev`/`prod` only) no longer has a
repo package or CI pipeline here — it stays up as a frozen, manually
decommissioned service until it's torn down.

## Worktrees

This checkout is shared — other agents and sessions move `HEAD` underneath you. Do
git work (branches, commits, PRs) in a worktree, not the main checkout. The native
worktree tool places them in `.claude/worktrees/` (gitignored); if you create one by
hand, put it under `.worktrees/` and remove it with `git worktree remove`, never
`rm` — `rm` leaves git's worktree metadata dangling. After a worktree's PR merges,
run `git worktree prune`.

Provision a fresh worktree with `scripts/worktree-setup.sh` (run from inside it):
copies untracked `.env` files from the main checkout, runs `npm ci`, builds the
workspace-internal packages, and regenerates the Prisma clients. Never symlink
`.env` files or `node_modules` across worktrees — tracked env files show up as
typechanges, and stale workspace-package `dist/` causes phantom lint/type errors.

## Observability and debugging (use the MCPs)

When investigating a bug or incident, use the MCP tools rather than guessing.

- **Grafana MCP** for logs (Loki), metrics (Prometheus), and traces (Tempo).
  Datasource UIDs: Loki `grafanacloud-logs`, Tempo `grafanacloud-traces`,
  Prometheus `grafanacloud-prom`. Narrow logs with labels `service_name`
  (`gp-api` | `election-api` | `people-api`) and `deployment_environment_name`
  (`dev` | `prod`), e.g.
  `{service_name="gp-api", deployment_environment_name="prod"}`.
- **Sentry MCP** for frontend errors. Org slug `goodparty`, region
  `https://us.sentry.io`.
- **Debugging deployed behavior?** Deployed code is whatever is on `origin/main`
  (dev) or, for prod, the last commit automated promotion shipped from `main`. It is
  not your local tree, and this checkout is shared, so `HEAD` may be stale. `git fetch
origin main` and read `origin/main` before forming any hypothesis.

Full label reference, example queries, and an incident playbook: `docs/observability.md`.

## MCP tools

Project-scoped MCP servers are configured in `.mcp.json` (Grafana, Sentry,
Playwright, ClickUp, Amplitude). They need a few environment variables set in your
shell — see `docs/mcp.md` for the list and what each server is for. Claude Code
plugins that ship their own tools (currently Slack) are enabled repo-wide in
`.claude/settings.json` under `enabledPlugins`, also documented in `docs/mcp.md`.

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
- Use Opus 5.0 as the fallback for those hard tasks when Fable is unavailable.
- If you think a task needs a more capable model than the current one, say so before
  proceeding.

## Style

- Be direct. Skip preambles and recaps.

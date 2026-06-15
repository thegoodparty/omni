# Chief of Staff dashboard — build plan (parallel slices)

Design doc: [`technical-design.md`](./technical-design.md). Read it first; the slice
specs assume it.

This folder breaks the feature into slices that multiple agents can build in
parallel. Each slice spec is self-contained: scope, files (omni paths), contracts,
migration, surface, acceptance criteria, tests.

## Repo

All work is in the **omni** monorepo (npm workspaces), `omni/packages/*`. omni is
the source of truth. Each agent works on its **own branch / git worktree** off the
same base and opens a small PR per slice.

## Standing rules (every slice)

- **Contracts**: shapes crossing gp-api ↔ gp-webapp go in `@goodparty_org/contracts`
  (`packages/contracts`), in the same PR. Each slice adds its **own** contract
  file(s) to avoid cross-agent conflicts. Use the `update-contract` skill.
- **Office resolution**: `@UseElectedOffice()` + `@ReqElectedOffice()` (needs the
  `X-Organization-Slug` header). No new auth path.
- **Definition of done**: `npm run verify` green in the touched package
  (`cd packages/gp-api && npm run verify` = lint + types + test; `lint:fix` to fix).
  Each slice ships with vitest tests. gp-webapp slices run that package's equivalent.
- Follow gp-api cursor rules (no `any`/`unknown`, 80-char, no semicolons, PrismaBase,
  library enums, date-fns).

## Slices and dependency graph

| Slice | What | Package(s) | Can start now? | Depends on |
|---|---|---|---|---|
| 1 | Priorities (model, CRUD, agent tools, Win seeding) | gp-api, contracts | Yes | — |
| 2 | Dashboard cards (model, generation hook, read/dismiss) | gp-api, contracts | Yes | — |
| 3 | General chat backend (conversation generalize, scope service, CoS handler, tools) | gp-api, contracts | Yes | soft: slice 1's priorities service for the `crud_priorities` tool |
| 4 | Support estimate (service + interim value) | gp-api, contracts | Yes | external: data+research table (interim stub until then) |
| 5 | Frontend (dashboard page, chat surface, history) | gp-webapp | Parallel against contracts; integrates last | contracts from 1,2,3,4 |
| 6a | Constituent-data tool — app-layer enforcement, flag-OFF, mocked provider | gp-api | Yes (flag-disabled) | — |
| 6b | Wire scoped credential, dev/qa security validation, enable | gp-api | **Blocked** | external: scoped Databricks credential + party column list |

```
        ┌──────── slice 1 (priorities) ────────┐
        ├──────── slice 2 (cards) ─────────────┤
start ──┼──────── slice 4 (support stub) ──────┼──► slice 5 (frontend) ──► integrate
        └──────── slice 3 (chat) ──────────────┘        (codes against contracts)
                       ▲ soft dep on slice 1 service
        slice 6a (constituent, app-layer, flag-OFF) buildable now
        slice 6b (wire scoped credential + security gate) — blocked on data team
```

## Parallelization rules (read before splitting work)

1. **Contracts: separate files per slice.** Slice 1 → `priorities` schema file,
   slice 2 → `dashboardCards`, slice 3 → `chats`, slice 4 → `supportEstimate`.
   Don't edit a shared index in a way that conflicts; append-only if you must.
2. **Migrations are the main coordination point.** gp-api Prisma migrations are a
   linear history. Slices 1, 2, 3 each add schema/migrations:
   - Slice 1 adds `priority.prisma`, slice 2 adds `dashboardCard.prisma`, slice 3
     **alters** `chatConversation.prisma` (+ enum) and backfills.
   - These touch different files, so the schema edits don't collide, but each branch
     generates a migration folder. On merge, apply in PR-merge order and re-run
     `migrate:dev` to reconcile. Avoid two open migrations renaming/altering the
     same table. The chat backfill (slice 3) is the one to review carefully.
3. **Frontend codes against contracts, not live endpoints.** Slice 5 starts as soon
   as the contract shapes exist (slices publish their contract file early), using
   typed mocks; it integrates against real endpoints when the backend slices land.
4. **Soft dep, slice 3 → slice 1:** the `crud_priorities` tool calls the priorities
   service. Build the chat infra + briefing read tools first; wire `crud_priorities`
   once slice 1's `PrioritiesService` exists (or against its interface).
5. **One agent per slice, own branch/worktree.** Keep PRs small and per-slice.

## Suggested first wave

Three agents in parallel: **slice 1**, **slice 2**, **slice 4** (all independent,
no external blockers). Start **slice 3** alongside (soft dep on 1). Bring up
**slice 5** against contracts, and **slice 6a** (app-layer enforcement, flag-OFF,
mocked provider). Hold **slice 6b** (wire the scoped credential + dev/qa security
validation) until the data team delivers the credential.

## External unblockers (not in our control)

- Support-estimate table keyed on `electedOfficeId` — data + research (Bryan). Slice
  4 ships an interim value behind the interface until then.
- Scoped "Serve agent" Databricks credential (table+column grants, no PII/party) +
  the party column to exclude — data team (Collin, Dan). Unblocks slice 6.
- Monorepo migration workflow confirmation (`migrate:pr` vs package `migrate:dev`).

## Running this with agents (orchestrator → sub-agents)

The orchestrator must be an agent type that can spawn sub-agents (e.g. `claude` /
`general-purpose`; `Explore`/`Plan` cannot). Dispatch one sub-agent per slice, each
in its own git worktree, then own the merge.

### Environment prerequisites (per sub-agent / worktree)

- **Docker running** — integration tests use testcontainers (a fresh
  `postgres:16-alpine` per run via `src/test-service.ts`), so test DBs are isolated
  automatically, but Docker must be available.
- **`npm install` in the worktree** — git worktrees don't share `node_modules`
  (gitignored); a fresh worktree must install before `verify` works.
- **Build contracts after adding shapes** — `cd packages/contracts && npm run build`
  (the `update-contract` skill does this) so consumers see the types.
- `.env.test` already has the required keys (`DATABASE_URL`, `TOGETHER_AI_KEY`,
  `AI_MODELS`); Anthropic/Tavily/Databricks keys are absent, so **tests must mock**
  those (use the existing DI seams — don't hit live services in tests).

### The one parallel hazard — `migrate:dev`

Integration *tests* are DB-isolated (testcontainers). But generating/applying a
migration runs against a local *dev* DB. Slices 1, 2, 3 each add a migration, so:

- Give each worktree its **own dev database** (unique `DATABASE_URL`) for
  `migrate:dev`, or serialize the migration step. (Confirm whether the monorepo's
  `migrate:pr` flow already does per-PR DBs.)
- Schema files don't collide (different files); the linear migration **history** is
  reconciled at merge — apply in PR-merge order and re-run `migrate:dev`. Slice 3's
  `ChatConversation` alter + backfill is the one to review carefully.

### Merge / integration (human-in-the-loop checkpoints)

Sub-agents produce a per-slice PR via the `ship-pr` skill (drives the
delegate-reviewer bot to approval). Keep a human at two checkpoints:

1. **Merge + migration reconciliation** — merge slices in order, re-run
   `migrate:dev` on the integrated branch, confirm `verify` green.
2. **Gated decisions** — slice 5's route, and slice 6's external credential.

Then run slice 5's integration against the real endpoints.

### Per-slice kickoff prompt (template)

Brief each sub-agent with this (substitute the slice number/package):

> You are implementing one slice of the Chief of Staff feature in the omni monorepo.
> Read your spec `omni/docs/chief-of-staff/slice-N-<name>.md`, plus this folder's
> `README.md` (standing rules + parallelization) and `technical-design.md` for
> context. Read the package conventions you'll touch:
> `packages/gp-api/CLAUDE.md`, its `.cursor/rules/`, and any module `CLAUDE.md`
> (e.g. `src/meetings/CLAUDE.md`, `prisma/CLAUDE.md`).
> Work in your own git worktree off `<base>`. Run `npm install` in it and use a
> unique `DATABASE_URL` for `migrate:dev`. Implement exactly the slice scope — strict
> scope, no extra refactors. Add contracts in `packages/contracts` (your own file)
> and rebuild. Definition of done: `cd packages/<pkg> && npm run verify` green, with
> vitest tests. When green, use the `ship-pr` skill to open a PR and drive it to
> approval. Do not touch other slices' files.
> (Slice 3 only: do NOT modify the briefing-chats controller/service; keep the
> `ChatConversation` change backward-compatible; the existing briefing-chat tests
> must still pass.)
> Report back: branch/PR link, what changed, and any deviations or blockers.

### Dispatch order

Wave A in parallel: **1, 2, 4**, plus **3** (wire `crud_priorities` after slice 1's
`PrioritiesService` exists or against its interface). **5** starts against contracts;
**6a** can join the wave (flag-off, mocked); **6b** stays blocked.

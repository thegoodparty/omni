# Scripts

One-off and recurring TypeScript scripts run via `tsx` or `npm run` aliases. Two flavours:

1. **Build / dev-loop scripts** wired into `package.json` (`build-contracts`, `check-pending-migrations`, `generate-route-types`).
2. **Operational / one-shot scripts** (backfills, drift reports, manual triggers) run on demand by engineers.

If logic only runs once and lives elsewhere, it doesn't belong here. If it's reusable and called from app code, it belongs in `src/`.

## Key files

| Path                                                              | Purpose                                                                                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `build-contracts.ts`                                              | Skips contract rebuild when `dist/` is fresher than `src/`; runs on `start:dev`, `build`, etc.                                |
| `check-pending-migrations.ts`                                     | Boots-time warning banner if `prisma migrate status` reports unapplied migrations                                             |
| `generate-route-types.ts`                                         | Walks `src/**/*.controller.ts` and emits a route-name → method/path map                                                       |
| `generate-agent-job-types.ts`                                     | Compiles `packages/runbooks/experiments/*/manifest.json` schemas → `src/generated/agent-job-contracts.ts` (local read, no S3) |
| `migrate-clean.ts` / `migrate-logger.ts`                          | Custom Prisma migrate wrappers used by `npm run migrate:*`                                                                    |
| `aws-setup.sh` / `setup-readonly-role.sh`                         | Bash helpers for first-time AWS setup; not used in CI                                                                         |
| `10dlc-status-drift-report.ts`                                    | Compares Peerly TCR state against our DB; one-shot operational                                                                |
| `requeue-stranded-compliance-runs.ts`                             | Flips compliance_setup runs stuck FAILED at `pending_website_live` back to AWAITING_RESUME (dry-run default, `--execute` to apply) |
| `backfill-voter-file-filter-orgs.ts`                              | Migration helper for the org-scoping change on `VoterFileFilter`                                                              |
| `find-stale-preview-stacks.ts`                                    | Lists Pulumi preview stacks with no matching open PR                                                                          |
| `refresh-preview-template.ts`                                     | Drops + recreates `gpdb_preview_template` empty, then migrate-deploys + seeds it (in-VPC via `aws ecs run-task`); see `deploy/CLAUDE.md` |
| `dispatch-experiment.ts` / `trigger-poll.ts` / `complete-poll.ts` | Manual queue producers for testing async flows                                                                                |
| `test-weekly-tasks-digest-event.ts`                               | Locally fires the weekly tasks digest handler                                                                                 |
| `output/`                                                         | Generated artefacts (e.g. agent metadata sync); gitignored content                                                            |
| `*.sql`                                                           | Read-only diagnostic queries (run via `psql`, not from app code)                                                              |

## Patterns

- **Run with `tsx`**: `npx tsx scripts/<name>.ts` (or via the matching `npm run` alias). Don't compile to `dist/` first.
- **Operational scripts must be safe to run twice.** Idempotency or an explicit `--dry-run` flag is the convention — see `backfill-voter-file-filter-orgs.ts`.
- **`scripts/output/`** is the agreed-upon dump path for generated artefacts. Add new outputs there, not at the repo root.
- **Don't import controllers/services from `src/`** unless you genuinely need the Nest container. Most scripts construct a `PrismaClient` directly.

## Gotchas

- `check-pending-migrations.ts` swallows non-pending errors silently — that's intentional (no DB locally is fine), don't "fix" it to throw.
- `build-contracts.ts` skips when `dist/` is newer; if you've edited contracts and the build appears stale, delete `contracts/dist/` to force a rebuild.
- `generate-agent-job-types.ts` reads experiment manifests straight from `packages/runbooks/experiments/` (no AWS creds, no S3 sync) and reflects the current branch. It is **not** run in CI; output must be committed. Run it after editing any `manifest.json`.
- One-off backfills accumulate. Move clearly-dead scripts out (or delete) when their migration is complete — Rule 20 (Remove Code Completely) applies here too.

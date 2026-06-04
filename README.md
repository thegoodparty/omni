# Omni

GoodParty's product monorepo (npm workspaces). See [`CLAUDE.md`](./CLAUDE.md) for the
system overview and how the apps relate.

> Status: MIGRATION IN PROGRESS. Until cutover, keep contributing to the existing
> source repos as usual — `scripts/sync-all.sh` continuously imports their commits
> here with full history. You'll be told when to switch over.

## Packages

All workspaces (apps and shared libs) live under a single `packages/` folder.

| Path | What | Local port |
|------|------|-----------|
| `packages/gp-api` | NestJS API (Prisma/Postgres) | 3000 |
| `packages/gp-webapp` | Next.js app (`good-party`) | 4000 |
| `packages/election-api` | NestJS microservice | — |
| `packages/people-api` | NestJS microservice | — |
| `packages/gp-admin` | Next.js admin | — |
| `packages/candidate-sites` | Next.js candidate sites | 4001 |
| `packages/gp-sdk` | `@goodparty_org/sdk` typed client | — |
| `packages/contracts` | `@goodparty_org/contracts` (post-cutover home) | — |

## Getting set up (post-cutover)

```bash
git clone --recurse-submodules git@github.com:thegoodparty/omni.git
cd omni
nvm use                 # Node from .nvmrc
npm install             # installs all workspaces
```

Create each app's local env files (copy from each app's `.env.example` / `.env.local`),
then start the core loop:

```bash
npm run dev             # Postgres + gp-api (:3000) + gp-webapp (:4000)
```

Run an individual app via its workspace name:

```bash
npm run start:dev -w gp-api
npm run dev -w good-party        # gp-webapp's package name is "good-party"
npm run start:dev -w election-api
```

## Migration tooling

- `npm run sync` — import/re-sync every repo in `scripts/repos.manifest`.
- `npm run sync -- gp-api` — sync a single repo.
- `npm run migrate:pr -- <app> <pr-number|branch>` — recreate an open PR here with
  authorship preserved. See [`docs/pr-migration.md`](./docs/pr-migration.md).

Requires `git-filter-repo` (pinned 2.47.0):

```bash
pip3 install --user git-filter-repo==2.47.0
```

### Automated sync

`.github/workflows/sync.yml` runs `sync-all` hourly (and on demand via
**Actions → Sync source repos → Run workflow**), pushing new history to `develop`.

Prerequisites:
- The org GitHub App (`vars.APP_ID` / `secrets.APP_PRIVATE_KEY`) must be installed on
  omni **and** every source repo (it needs read on sources, write on omni). To use a
  PAT instead, set `secrets.SYNC_TOKEN` and swap the token step in the workflow.
- If `develop` is a protected branch, allow the sync bot to bypass it (or repoint the
  workflow at an unprotected branch).

Controls: set repo variable `SYNC_DISABLED=true` to pause; delete the workflow at cutover.

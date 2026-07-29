[<img src="./docs/goodparty-logo.svg" alt="GoodParty.org" width="500" />](https://www.goodparty.org)

The GoodParty.org product monorepo — the candidate web app, the API monolith, a
data microservice, the admin console, the candidate sites, and the shared SDK and
contracts, all in one npm-workspaces repo.

**Working with an agent?** Start at [`CLAUDE.md`](./CLAUDE.md). It's the map: repo-wide
conventions plus pointers to per-package `CLAUDE.md` files and the docs below.

## Packages

All workspaces (apps and shared libs) live under `packages/`.

| Path                       | What                                            | Port |
| -------------------------- | ----------------------------------------------- | ---- |
| `packages/gp-api`          | NestJS API monolith (Prisma/Postgres)           | 3000 |
| `packages/gp-webapp`       | Next.js product app (candidates & officials)    | 4000 |
| `packages/election-api`    | NestJS microservice — election data             | 3001 |
| `packages/gp-admin`        | Next.js internal admin console                  | 3500 |
| `packages/candidate-sites` | Next.js per-candidate sites                     | 4001 |
| `packages/gp-sdk`          | `@goodparty_org/sdk` — typed API client         | —    |
| `packages/contracts`       | `@goodparty_org/contracts` — Zod schemas/types  | —    |
| `packages/runbooks`        | Agent runbooks, slash commands, PMF experiments | —    |

## Quickstart

```bash
git clone --recurse-submodules git@github.com:thegoodparty/omni.git
cd omni
nvm use          # Node from .nvmrc
npm install      # installs all workspaces
npm run dev      # Postgres + gp-api (:3000) + gp-webapp (:4000)
```

Each app needs its own local env files (copy from each app's `.env.example` /
`.env.local`). Run an individual app by workspace name:

```bash
npm run start:dev -w gp-api
npm run dev -w packages/gp-webapp
```

More in [`docs/development.md`](./docs/development.md).

## Documentation

| Topic                      | Doc                                                |
| -------------------------- | -------------------------------------------------- |
| Repo map + conventions     | [`CLAUDE.md`](./CLAUDE.md)                         |
| Architecture / service map | [`docs/architecture.md`](./docs/architecture.md)   |
| Local development          | [`docs/development.md`](./docs/development.md)     |
| Testing                    | [`docs/testing.md`](./docs/testing.md)             |
| Deployment + CI            | [`docs/deployment.md`](./docs/deployment.md)       |
| Observability / debugging  | [`docs/observability.md`](./docs/observability.md) |
| MCP tools                  | [`docs/mcp.md`](./docs/mcp.md)                     |

Each package also carries its own `CLAUDE.md` with detailed, area-specific guidance.

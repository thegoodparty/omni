# Omni — GoodParty Product Monorepo

This repository consolidates GoodParty's product code into a single npm-workspaces
monorepo so agents and humans share one context, deploys are unified, and shared
code is de-duplicated.

## Layout

A single top-level `packages/` folder holds every workspace — both deployable apps
and shared libraries (npm workspaces treats them uniformly; this avoids any nested
workspaces).

```
packages/
  gp-api/            NestJS + Fastify API (Prisma/Postgres).
  gp-webapp/         Next.js candidate/marketing app (package name: "good-party").
  election-api/      NestJS microservice — election data.
  people-api/        NestJS microservice — voter/people data.
  gp-admin/          Next.js internal admin tool (consumes the SDK).
  candidate-sites/   Next.js per-candidate sites.
  gp-sdk/            @goodparty_org/sdk — typed API client.
  contracts/         @goodparty_org/contracts — Zod schemas/types (built from gp-api Prisma).
scripts/     Migration + dev tooling.
```

During the migration's sync phase, `contracts` is still carried inside gp-api (it
lands at `packages/gp-api/contracts`); it is promoted to its own top-level
`packages/contracts` at cutover so there are no nested workspaces.

## How the system fits together

- gp-webapp and gp-admin talk to gp-api over HTTP.
- gp-api calls election-api and people-api (internal microservices).
- `@goodparty_org/contracts` is the shared type/schema source (built in gp-api),
  consumed by the SDK; gp-admin uses the SDK. (gp-webapp currently keeps its own
  hand-rolled types in `packages/gp-webapp/gpApi` + `helpers/types.ts`.)

## Working in this repo

- Node is pinned in `.nvmrc` (`nvm use`). Install everything from the root: `npm install`.
- Per-app commands use workspaces, e.g. `npm run start:dev -w gp-api`, `npm run dev -w good-party`.
- `npm run dev` boots Postgres + gp-api + gp-webapp (see `scripts/dev.sh`).
- Each app keeps its own detailed `CLAUDE.md` (e.g. `packages/gp-api/CLAUDE.md`). Read the
  relevant one before deep work in a given app.

## Branching / deploys

`develop -> qa -> master` map to `dev / qa / prod`. Backends deploy via Docker/ECR/
Pulumi to ECS Fargate; frontends deploy via Vercel.

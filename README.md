[<img src="./docs/goodparty-logo.svg" alt="GoodParty.org" width="500" />](https://www.goodparty.org)

The GoodParty.org product monorepo. See [`CLAUDE.md`](./CLAUDE.md) for the
system overview and how the packages relate.

## Packages

All workspaces (apps and shared libs) live under a single `packages/` folder.

| Path                       | What                                           | Local port |
| -------------------------- | ---------------------------------------------- | ---------- |
| `packages/gp-api`          | NestJS API (Prisma/Postgres)                   | 3000       |
| `packages/gp-webapp`       | Next.js app (`good-party`)                     | 4000       |
| `packages/election-api`    | NestJS microservice                            | —          |
| `packages/people-api`      | NestJS microservice                            | —          |
| `packages/gp-admin`        | Next.js admin                                  | —          |
| `packages/candidate-sites` | Next.js candidate sites                        | 4001       |
| `packages/gp-sdk`          | `@goodparty_org/sdk` typed client              | —          |
| `packages/contracts`       | `@goodparty_org/contracts` (post-cutover home) | —          |

## Setup

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

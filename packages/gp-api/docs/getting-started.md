# Getting started

Setup is one command, from the repo root: `npm run setup` (`docs/development.md`).
It installs dependencies, vends dev-grade secrets, brings up gp-api + gp-webapp
against a local Postgres, migrates + seeds, and seeds a login. This doc covers
gp-api once your stack is running.

## Common commands

Run from `packages/gp-api/`:

| Task                                    | Command                                   |
| ---------------------------------------- | ------------------------------------------ |
| Start gp-api alone                      | `npm run start:dev` (:3000)               |
| Verify a change (lint + types + tests) | `npm run verify`                          |
| Run a single test file                 | `npx vitest run src/path/to/file.test.ts` |
| Apply a new migration                  | `npm run migrate:dev`                     |
| Reset local DB                         | `npm run migrate:reset`                   |
| Regenerate Prisma client + route types | `npm run generate`                        |
| Diff infra for an env                  | `npm run infra diff dev`                  |

## Related docs

- `AGENTS.md` — the canonical agent/contributor guide (kept short, commands first)
- `docs/writing-tests.md` — testing patterns and when to reach for each
- `docs/observability.md` — Grafana alerts, Loki, Tempo
- `docs/debugging.md` — reproducing bugs with `useTestService`
- `docs/contracts.md` — working with `@goodparty_org/contracts`
- `docs/team-setup.md` — deeper setup detail (nvm, npm ci flags, IDE config)

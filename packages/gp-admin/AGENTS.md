# AGENTS.md

Guidance for Claude Code and other AI agents working in `gp-admin`. Keep this file short — push detail into `README.md`.

## Project

Internal staff admin console (Next.js 16 App Router, port 3500). Talks to `gp-api` through `@goodparty_org/sdk` with Clerk M2M auth. Access is gated by Clerk **Organizations** (Development / Production) — a single deployment targets both environments via org switch. Roles: `org:admin`, `org:sales`, `org:read_only`. See `README.md` for the auth/role/permission tables and E2E test-user setup.

## Commands (most-used first)

```bash
npm run dev              # next dev -p 3500 --turbopack
npm run build            # next build
npm run lint             # eslint .
npm run format           # prettier --write "**/*.{ts,tsx,md}" (mutates files — stage first)
npm run test             # vitest run
npm run test:watch       # watch mode
npm run test:coverage    # vitest run --coverage
npm run test:e2e         # playwright test (needs Clerk test-user env vars — see README.md)
```

`gp-admin` depends on `@goodparty_org/sdk`, which is an in-tree workspace package — build it (`npm run build -w packages/gp-sdk`) when the SDK source changes.

## Verify

Reproduce the CI **Validate** job (`.github/workflows/gp-admin.yml`) before opening a PR. CI builds the in-tree contracts and SDK first because gp-admin consumes the SDK and the SDK consumes contracts. From the repo root:

```bash
npm run build -w packages/contracts        # build contracts the SDK imports
npm run build -w packages/gp-sdk           # build the in-tree SDK gp-admin imports
npm run lint -w packages/gp-admin          # eslint .
npm run test:coverage -w packages/gp-admin # vitest run --coverage
```

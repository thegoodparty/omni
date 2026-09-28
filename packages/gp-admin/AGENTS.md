# AGENTS.md

Guidance for Claude Code and other AI agents working in `gp-admin`. Keep this file short — push detail into `README.md`.

## Project

Internal staff admin console (Next.js 16 App Router, port 3500). Talks to `gp-api` through `@goodparty_org/sdk` with Clerk M2M auth. Viewers are gated by Clerk **Organizations** (Development / Production); the org a viewer has active picks which gp-api the console calls. Roles: `org:admin`, `org:sales`, `org:read_only`. See `README.md` for the auth/role/permission tables and E2E test-user setup.

## Which gp-api a deployment reaches

`GP_ADMIN_ENVIRONMENTS` is a comma-separated allow-list (`dev`, `prod`) naming the gp-api environments one deployment may reach. **The intended setup is one deployment per environment**, each listing a single environment and holding only that environment's `GP_<ENV>_MACHINE_SECRET`, `GP_<ENV>_API_DOMAIN` and webapp URL. Unset means every known environment, which is what a deployment configured for all of them at once relies on.

`src/shared/util/gpEnvironment.ts` is the only place that maps an environment to its env vars:

- `servedEnvironments()` parses the allow-list; an unknown name is a hard error, not a silent drop.
- `resolveEnvironment(orgId)` maps the active Clerk org (`GP_ORG_ID_DEV` / `GP_ORG_ID_PROD`) to an environment and throws when that environment is not served. Every server action reaches gp-api through `gpAction`, which calls it, so an out-of-scope org gets an error rather than a client.
- `getEnvironmentConfig(env)` re-checks before reading a secret, and the per-environment key map has no default entry — there is no path by which one environment's request picks up another's secret.

Clerk organizations are instance-wide, so the header's `OrganizationSwitcher` lists every org a viewer belongs to no matter which deployment they are on. `src/components/EnvironmentGate.tsx` (server component, wired into `src/app/dashboard/layout.tsx`) is what keeps a listed-but-unserved org from rendering a dashboard: it replaces the page with a callout naming the environment this deployment does reach.

Adding an environment means: a `GP_ENVIRONMENT` entry, its three env-var names in `ORG_ID_ENV_KEYS`/`ENV_CONFIG_KEYS`, a webapp URL in each `getWebappUrl`, and the Clerk org.

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

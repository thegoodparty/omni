# AGENTS.md

Guidance for Claude Code and other AI agents working in `gp-sdk`. Keep this file short — push detail into `docs/`.

## Project

`@goodparty_org/sdk` — TypeScript SDK consumers use to call `gp-api` over HTTP with Clerk M2M auth. Built with `tsup` (CJS + ESM + d.ts). Downstream consumers: `gp-admin`, `gp-api`, `gp-webapp`, and any other service that talks to `gp-api` server-to-server. **Changes here ripple to every consumer**, but inside omni they ripple instantly — consumers depend on it via a `"*"` workspace dependency and a node_modules symlink, so a change is live as soon as it's built; no version bump or install. It is a **library**, not an app — there is no server, no DB, no runtime here.

**In-tree, not published.** Despite the scoped `@goodparty_org/sdk` name, this is an in-tree workspace package, not a live npm-registry package. npm publishing is intentionally disabled in omni (see the "publish ... not enabled in omni yet" note in `.github/workflows/gp-sdk.yml`). It was published pre-monorepo; don't assume the scoped name implies a registry release.

## Commands (most-used first)

```bash
npm run dev              # tsup --watch (rebuild on save into ./dist)
npm run build            # tsup (CJS + ESM + d.ts → ./dist)
npm run typecheck        # tsc --noEmit
npm run lint             # eslint --quiet (read-only)
npm run lint:fix         # eslint --fix (mutates files — stage first)
npm run format           # prettier --write
npm run format:check     # prettier --check (CI uses this)
npm run lint-format      # lint:fix + format
```

## Verify

Reproduce the CI **Validate** job (`.github/workflows/gp-sdk.yml`) before opening a PR. CI builds the in-tree contracts first because the SDK imports them. From the repo root:

```bash
npm run build -w packages/contracts       # build contracts the SDK imports
npm run typecheck -w packages/gp-sdk      # tsc --noEmit
npm run lint -w packages/gp-sdk           # eslint --quiet (read-only)
npm run format:check -w packages/gp-sdk   # prettier --check
npm run build -w packages/gp-sdk          # tsup (CJS + ESM + d.ts)
```

## Pointer table — when in doubt

| Doing                                             | Read                                  |
| ------------------------------------------------- | ------------------------------------- |
| Adding a resource / endpoint                      | `docs/architecture.md` § Module shape |
| First-time setup, linking locally into a consumer | `docs/getting-started.md`             |
| AI rule-by-rule code review                       | `ai-rules/` (git submodule)           |

## Code style

- **No semicolons**, single quotes, trailing commas (`.prettierrc`)
- `@typescript-eslint/no-explicit-any` is **an error** — never silence with `any`. Use `unknown` and narrow, or derive a proper type.
- `@typescript-eslint/no-unsafe-assignment` is **an error**.
- `unused-imports/no-unused-imports` is **an error**.
- TypeScript: `strict: true`, `noImplicitAny: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`. Public surface is `src/index.ts`.
- Arrow functions over `function` declarations (matches existing style across `resources/`, `http/`, `vendor/`).

`.cursor/rules/` mirrors three rules that apply globally:

- **`use-library-features.mdc`** — Don't reimplement what `ofetch` (or any dep) already does. Query strings, JSON serialization, base URL, headers — use the library option.
- **`use-library-types.mdc`** — Import the library's exported type instead of writing a bespoke one. Use `Pick`/`Omit`/indexed access when you need a subset.
- **`update-readme.mdc`** — Public-API changes **must** update `README.md` in the same change. The README is the package's consumer-facing contract; if it lies, consumers get burned.

## Module shape

```
src/
├── index.ts                        # public surface (the only export entry)
├── GoodPartyClient.ts              # composes resources + auth, returns a client
├── enums.ts                        # local enum re-exports (UserRole, WhyBrowsing, CampaignTier)
├── http/HttpClient.ts              # ofetch wrapper; injects Bearer token; throws SdkError
├── resources/
│   ├── BaseResource.ts             # abstract: getRequest / postRequest / put / patch / delete
│   ├── UsersResource.ts            # canonical reference — shortest, simplest
│   ├── CampaignsResource.ts
│   ├── EcanvasserResource.ts
│   ├── ElectedOfficesResource.ts
│   ├── ElectionsResource.ts
│   ├── OrganizationsResource.ts
│   └── AdminResource.ts
├── types/                          # local types not yet in @goodparty_org/contracts
│   └── (admin | campaign | district | electedOffice | organization | result).ts
└── vendor/clerk/clerk.service.ts   # M2M token fetching + auto-renew + destroy()
```

`src/resources/UsersResource.ts` is the canonical reference for adding a new resource.

## Resource pattern

Every resource extends `BaseResource` (in `src/resources/BaseResource.ts`), declares a `resourceBasePath`, and uses the inherited `{get,post,put,patch,delete}Request` methods. Don't call `httpClient.request` directly from a resource — go through the BaseResource helpers so HTTP method coverage stays uniform.

Method signatures should accept and return types imported from `@goodparty_org/contracts` whenever the contract exists. Types still defined locally in `src/types/` (electedOffice, district, parts of campaign, organization, admin) are temporary — when they land in `contracts`, drop the local one and re-export from contracts via `src/index.ts`. See `docs/architecture.md` § Type-sharing flow.

## Testing

No test framework is configured and no `npm test` script exists. Don't add one unless you're also adding tests **and** wiring them into `.github/workflows/ci.yml` — a `test` script that does nothing (or always passes) is worse than no script.

## Auth

`GoodPartyClient.create({ m2mSecret, gpApiRootUrl })` builds a `ClerkService` (in `src/vendor/clerk/clerk.service.ts`) that exchanges the M2M secret for a short-lived token via `@clerk/backend`. The token is cached, auto-renewed on a timer, and injected as `Authorization: Bearer …` by `HttpClient`. **Consumers must call `client.destroy()`** to stop the renewal timer — otherwise the process won't exit cleanly. Document this on every public entry point you add.

## Never

- Never expose `ClerkService` (or any of `src/vendor/`) through `src/index.ts`. It's an internal implementation detail; the public surface is `GoodPartyClient` + types.
- Never write a custom HTTP / query-string / JSON layer on top of `ofetch` — use the library option (per `.cursor/rules/use-library-features.mdc`).
- Never duplicate types that exist in `@goodparty_org/contracts`. Import from contracts, or `Pick`/`Omit` from a contract type. Adding a fresh local type for a contract that exists is a mistake.
- Never break a public export without updating the consumers in the same PR and documenting the new contract.

## Environment

- **Node 22**. The monorepo root `package.json` is the source of truth.
- **npm workspaces** from the monorepo root.
- No env vars at build time. Consumers pass `m2mSecret` and `gpApiRootUrl` at runtime via `GoodPartyClient.create({ … })`.
- The `postinstall` hook only fires inside this repo (it's gated on `.gitmodules` existing) and pulls `ai-rules/`. It is intentionally a no-op when the package is installed as a dependency from npm — consumers don't get our submodule, and their installs don't shell out to `git`. If `ai-rules/` is empty in a fresh clone, run `git submodule update --init --recursive` manually.

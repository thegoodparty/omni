# Architecture

A pointer-heavy doc. Detailed conventions live in `CLAUDE.md` and `ai-rules/`.

## Stack

- **TypeScript 5** strict, ES2022 target, ESNext modules, `bundler` resolution.
- **Build:** `tsup` — emits CommonJS (`.js`), ES modules (`.mjs`), and declarations (`.d.ts`) from a single entry (`src/index.ts`) into `dist/`.
- **Lint/format:** ESLint (`@typescript-eslint`, `unused-imports`, `prettier/recommended`) + Prettier (no semis, single quotes, trailing-comma all).
- **HTTP:** [`ofetch`](https://github.com/unjs/ofetch) — used directly, **never wrapped in custom logic**. See `.cursor/rules/use-library-features.mdc`.
- **Auth:** Clerk M2M tokens via `@clerk/backend`. The SDK exchanges a long-lived M2M secret for a short-lived JWT and renews it on a timer.
- **Types:** Pulled from `@goodparty_org/contracts` (a sibling package containing Zod schemas + inferred TS types) wherever a contract exists. Some types still defined locally in `src/types/` until contracts catches up.
- **Versioning/release:** [Changesets](https://github.com/changesets/changesets) — see `docs/getting-started.md` § Releasing.
- **CI:** `.github/workflows/ci.yml` runs typecheck → lint → format:check → build on every push to a non-master branch. `.github/workflows/publish.yml` runs the same on merges to `master`, then invokes `changesets/action` to open/publish the release PR.
- **No tests yet.** No vitest/jest config, no `npm test` script. If you add tests, also wire CI to run them.

## Module shape

```
src/
├── index.ts                        # public surface — the only allowed entry
├── GoodPartyClient.ts              # composes resources + ClerkService
├── enums.ts                        # value-side re-exports of string-union enums
├── http/
│   └── HttpClient.ts               # ofetch wrapper; injects Bearer token; SdkError
├── resources/
│   ├── BaseResource.ts             # abstract — getRequest / postRequest / put / patch / delete
│   ├── UsersResource.ts            # canonical reference — copy this shape for new resources
│   ├── CampaignsResource.ts
│   ├── EcanvasserResource.ts
│   ├── ElectedOfficesResource.ts
│   ├── ElectionsResource.ts
│   ├── OrganizationsResource.ts
│   └── AdminResource.ts
├── types/                          # local types not yet in @goodparty_org/contracts
│   ├── admin.ts
│   ├── campaign.ts                 # CampaignWithLiveContext, CampaignWithPositionName, RaceTargetMetrics
│   ├── district.ts                 # district list/update inputs/outputs
│   ├── electedOffice.ts            # not yet in contracts
│   ├── organization.ts             # not yet in contracts
│   └── result.ts                   # SdkError class
└── vendor/
    └── clerk/
        └── clerk.service.ts        # private — never re-exported
```

`src/resources/UsersResource.ts` is the cleanest reference resource: 5 methods, all four HTTP verbs, all types from `contracts`. Start there.

## Public surface

`src/index.ts` is the only file consumers can import from (`tsup` only emits its exports). Keep this file intentional:

- **Class export:** `GoodPartyClient`
- **Class export:** `SdkError`
- **Type-only re-exports** from `@goodparty_org/contracts` (campaigns, users, ecanvasser, etc.)
- **Value re-exports** of `*_VALUES` arrays + their types from `contracts`
- **Local enum objects:** `UserRole`, `WhyBrowsing`, `CampaignTier` (constructed from `_VALUES` so consumers can use them like classic enums)
- **Local-only types** for resources where contracts don't yet have a schema

When a contract becomes available for a locally-defined type, replace the local `import type` with a `contracts` re-export and delete the corresponding file in `src/types/`. **Don't** keep both — that's how drift happens.

## Auth flow

```
consumer
   │  GoodPartyClient.create({ m2mSecret, gpApiRootUrl })
   ▼
ClerkService(m2mSecret)
   │  await getToken()     ← cached, auto-renewed on a timer
   ▼  Authorization: Bearer <jwt>
HttpClient.request(path, init?)
   │  baseURL = gpApiRootUrl
   ▼  ofetch<T>(...)        ← throws FetchError on non-2xx
SdkError(status, message, response?)
```

`ClerkService.destroy()` clears the renewal timer. Without `client.destroy()` the Node process stays alive after consumers are done with the client. Document this on any new public entry point.

## Cross-service edges

| Direction | Service | Protocol | Auth |
|-----------|---------|----------|------|
| outbound | `gp-api` | HTTP (ofetch) | Bearer M2M JWT (Clerk) |
| inbound | `gp-admin`, `gp-api`, `gp-webapp`, and other server-side consumers | npm dep on `@goodparty_org/sdk` | (n/a — they import the package) |

Shared types flow: **Prisma models in `gp-api`** → `@goodparty_org/contracts` (Zod schemas + inferred TS types) → **this SDK** (re-exports) → `gp-admin` (consumes via this SDK). Locally-defined types under `src/types/` are stopgaps for entities not yet in `contracts` (`electedOffice`, parts of `district`/`organization`); they should migrate to contracts when their server-side schemas land there.

## Type-sharing flow

The single most important architectural rule: **a contract type wins over a local type.** The order of preference, from highest:

1. Import from `@goodparty_org/contracts` (Zod-inferred TS type).
2. Derive from a contract type via indexed access / `Pick` / `Omit`.
3. Import a library type (e.g. `FetchOptions<'json'>` from `ofetch`).
4. Define locally under `src/types/` — only if 1–3 don't fit, with a comment explaining what contract eventually replaces it.

Adding a brand-new local type for an entity that already has a contract schema is the most common drift bug we see. Spot it in PR review.

## Build pipeline

```
src/index.ts (entry)
   │
   ▼  tsup (esbuild + rollup-style bundling)
dist/
├── index.js          # CommonJS — for `require()`
├── index.mjs         # ES modules — for `import`
├── index.d.ts        # type declarations
└── *.map             # source maps
```

Configured in `tsup.config.ts`: single-entry, `format: ['cjs', 'esm']`, `dts: true`, `splitting: false` (one file per format keeps the consumer side trivial), `clean: true` outside watch mode. Only `dist/` is published (`"files": ["dist"]` in `package.json`).

## Bootstrap (consumer side)

There's no app bootstrap — this is a library. The "boot" is whatever the consumer does:

```typescript
const client = await GoodPartyClient.create({
  m2mSecret: process.env.GP_MACHINE_SECRET,
  gpApiRootUrl: 'https://gp-api.goodparty.org/v1',
})
// … use client.users / client.campaigns / etc.
client.destroy()
```

`GoodPartyClient.create` is async because it eagerly fetches a token before returning, so the first user-facing call doesn't pay the auth round-trip latency.

## Key patterns

- **`BaseResource` superclass** — every resource extends it and inherits typed `{get,post,put,patch,delete}Request`. Don't reach for `httpClient.request` directly from a resource; new HTTP behavior belongs on `HttpClient` or `BaseResource`, not duplicated per resource.
- **Errors collapse to `SdkError`** — `HttpClient.request` catches both `FetchError` and unknown thrown values and re-throws `SdkError(status, message, response?)`. Consumers handle one error type.
- **Token renewal lives in vendor code** — `ClerkService` owns caching + renewal + a `pendingTokenPromise` so concurrent first calls don't race. Don't replicate this elsewhere; if a new auth path is needed, extend the vendor module.
- **Enum objects are derived, not duplicated** — `enums.ts` builds `{ X: 'X', Y: 'Y' }` from the contracts' `*_VALUES` arrays via `Object.fromEntries`. New enums follow the same pattern.

## ADRs

`docs/adr/` is not yet seeded. Add one when a non-obvious decision lands (e.g., why `ofetch`, why CJS+ESM dual-format, why Clerk M2M instead of static API keys, why types live in a separate `contracts` package). Use `ai-rules/adr-template.md`.

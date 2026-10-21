# Dev Env Module

Hands a new contributor the `.env` values for a local checkout without a human
ever reading a credential. `POST /v1/dev-env/bundle` takes a GitHub user token,
verifies active membership in the `thegoodparty` org, and returns per-package
bundles read from the curated `LOCAL_DEV_ENV` Secrets Manager blob.

| Route                            | Guard                  | Purpose                                     |
| -------------------------------- | ---------------------- | ------------------------------------------- |
| `POST /v1/dev-env/bundle`        | `GithubOrgMemberGuard` | Per-package local `.env` values             |
| `POST /v1/dev-env/election-seed` | `GithubOrgMemberGuard` | Presigned URL for the local election seed   |

The response carries live dev credentials by contract (`DevEnvBundleResponse`
in `@goodparty_org/contracts`) — **never log a response object**. Deliberately
not an `@McpTool`: this is a human bootstrap surface.

## How it is gated

- `IS_NON_PROD_DEPLOY` false → 404, checked in the guard as well as the
  handler. The guard's copy is load-bearing: a guard runs first, so without it
  prod would answer 401 (proving the route exists) and would forward an
  attacker-supplied token to api.github.com before the handler's 404.
- `GithubOrgMemberGuard` spends the bearer token on one call,
  `GET /user/memberships/orgs/thegoodparty`, and requires `state: 'active'`.
  The token is never persisted, never logged, and never sent anywhere else.
  Rejections carry no diagnostic detail: 401 for a bad token, 403 for a
  non-member / pending invite / unscoped token, 502 when GitHub is unreachable.
- There is no rate limit, by decision (ENG-11186 TDD review): org membership
  plus the per-fetch audit line is the whole abuse posture.
- The GitHub token travels in a dedicated `X-GitHub-Token` header, never
  `Authorization`: the global `SessionGuard` tries every `Authorization`
  bearer as a Clerk session first, and `ClerkAuthService` wraps a failed
  verification in an `UnauthorizedException` that `SessionGuard` rethrows
  even on `@PublicAccess()` routes — a `gho_*` bearer 401s before this
  guard ever runs (found live on dev; the first design assumed the failure
  fell through to public).

## The secret

`LOCAL_DEV_ENV_SECRET_ID` names the Secrets Manager blob; `deploy/index.ts`
sets it on the **dev** deploy only and grants the dev task role
`secretsmanager:GetSecretValue` on that one secret. Unset (preview, prod,
most laptops) vending answers 503 — it is a `degradable` feature, not a boot
dependency, because creating the secret is an ops step that can lag the code.

`mcp` is the one bundle that is not a package: the repo's MCP-server tokens,
written to the root `.env.mcp.local` and declared in the manifest by hand
(today only `GRAFANA_SERVICE_ACCOUNT_TOKEN`). Add its entry to the blob only
after the gp-api that knows `mcp` is on dev, or every fetch 500s on an
undeclared package.

The blob is `{ "<package>": { "<ENV_VAR>": "<value>" } }` and **is** the
allowlist: there is no filtering code that could leak a non-vendable key.
`DECLARED_ENV_VARS` in `devEnv.manifest.ts` is the sanity check on top — a
blob key no package's env contract declares fails the whole fetch rather than
being vended.

## The election seed

`POST /v1/dev-env/election-seed` presigns a 15-minute GET for
`election-seed.sql.gz` in `LOCAL_ELECTION_SEED_BUCKET`
(`gp-local-election-seed-dev`, created by `deploy/index.ts` on the dev deploy
only, with `s3:GetObject` on the task role). Unset bucket or a missing object
answers 503. The seed holds BallotReady-derived election data and L2-derived
aggregates, which is why it is gated here and never committed: this repo is
public. Building and uploading it is in `src/electionDb/AGENTS.md`.

## Gotchas

- `devEnv.manifest.ts` mirrors `packages/gp-webapp/env.schema.ts` by hand
  because `deploy/Dockerfile` copies only gp-api's own `src` plus the prebuilt
  contracts package, so a sibling package's source is unresolvable at runtime.
  `devEnv.manifest.test.ts` parses that file and fails on drift either way —
  if it fails, update the mirror, don't loosen the test.
- Keys that live in both `GP_API_DEV` and `LOCAL_DEV_ENV` rotate in two
  places. Named tech debt, accepted in the TDD; the set is small and
  rotations are rare.

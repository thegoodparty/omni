# AGENTS.md

Guidance for Claude Code and other AI agents working in `gp-admin`. Keep this file short — push detail into `README.md`.

## Project

Internal staff admin console (Next.js 16 App Router, port 3500). Talks to `gp-api` through its own typed client in `src/shared/gpApi/` (`GoodPartyClient`, one resource class per gp-api surface), authenticated as set by `GP_API_AUTH_MODE` (see "gp-api auth" below). Access is gated by Clerk **Organizations** (Development / Production) — a single deployment targets both environments via org switch. Roles: `org:admin`, `org:sales`, `org:read_only`. See `README.md` for the auth/role/permission tables and E2E test-user setup.

## Commands (most-used first)

```bash
npm run dev              # next dev -p 3500 --turbopack
npm run build            # next typegen + tsc --noEmit (TS 7) + next build
npm run lint             # eslint .
npm run format           # prettier --write "**/*.{ts,tsx,md}" (mutates files — stage first)
npm run test             # vitest run
npm run test:watch       # watch mode
npm run test:coverage    # vitest run --coverage
npm run test:e2e         # playwright test (needs Clerk test-user env vars — see README.md)
```

`gp-admin` imports `@goodparty_org/contracts`, an in-tree workspace package — build it (`npm run build -w packages/contracts`) when contracts source changes. To call a new gp-api endpoint, add a method to the matching resource in `src/shared/gpApi/resources/` (or a new resource registered in `GoodPartyClient.ts`), typed with the contracts schema, and call it through `gpAction` (`src/shared/util/gpClient.util.ts`).

## gp-api auth

`GP_API_AUTH_MODE` (server-only) picks the Bearer token `GoodPartyClient` sends. The only values are `clerk` and `oidc`; unset means `clerk`, and anything else throws on every gp-api call.

- `clerk`: a Clerk M2M token minted from `GP_DEV_MACHINE_SECRET` / `GP_PROD_MACHINE_SECRET` (whichever matches the active org).
- `oidc`: the deployment's Vercel OIDC token from `getVercelOidcToken()` (`@vercel/oidc`, default audience), fetched for every request and never cached. When no token can be obtained (e.g. local dev without `vercel env pull`), it falls back to the Clerk M2M token; with no machine secret either, the call fails.

Prod gp-api accepts only gp-admin's `production` deployment token, so in `oidc` mode a preview or local build gets a 401/403 on the Production org. `gpAction` tags a 401/403 with the `GP_API_ACCESS_DENIED` digest, and `src/app/dashboard/error.tsx` and `describeActionFailure` turn it into "switch to Development" instead of the crash page. Tokens are only read in server actions and server components; never import the client from a client component.

## 10DLC widget on the user page

`users/[id]/components/CvPinStatus.tsx` shows the Pro campaign's 10DLC stage and its SMS texting window (`smsCompliance`, `smsCutoffDate`, `generalElectionDate` from the admin compliance-state response). gp-api computes the window (`smsComplianceWindow` in `eligibility.util.ts`); never redo the date math here. A wrong cutoff is fixed by editing the campaign's election date.

## Public profile card on the user page

`users/[id]/components/PublicProfileCard.tsx` shows which `/people` page the
account is linked to. When it isn't linked, staff with `write_users` get "Link
to public profile": they paste the page's link, confirm the user and the person,
and it calls `POST /v1/person-profiles/links`. That's the fix for a candidate
stuck on "still setting up your official record" because their person record
also holds a duplicate or deleted account. It never moves an existing link;
gp-api refuses that, and a person held by another user, with a message the
dialog shows as-is.

## Observability

Errors report to Sentry (client + server via `src/instrumentation*.ts`) once
`NEXT_PUBLIC_SENTRY_DSN` is set on the Vercel project; unset, the wiring is a
no-op. Server-side `onRequestError` captures server-action throws with their
real messages — the browser only ever sees a redacted one in prod. So when a
staff member must read the failure (a toast), the action must **return** the
error (`{ error: string | null }`, message via `extractApiErrorMessage`)
instead of throwing; `resendCvPin` is the reference. Client-side catches around action
calls use `describeActionFailure`, which turns deploy-skew transport failures
("Failed to find Server Action") into a refresh hint.

## Verify

Reproduce the CI **Validate** job (`.github/workflows/gp-admin.yml`) before opening a PR. CI builds the in-tree contracts first because gp-admin consumes them. From the repo root:

```bash
npm run build -w packages/contracts        # build the in-tree contracts gp-admin imports
npm run lint -w packages/gp-admin          # eslint .
npm run test:coverage -w packages/gp-admin # vitest run --coverage
```

## Email sends page

`src/app/dashboard/email-sends/` lists paused email sends (gp-api `/admin/outreach/email`, keyed on the Outreach id) with SES's bounce and complaint rates since the last resume. Resume and Cancel are `org:admin` only; Resume is hidden for `ses_tenant`, which only AWS can clear.

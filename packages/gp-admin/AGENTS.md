# AGENTS.md

Guidance for Claude Code and other AI agents working in `gp-admin`. Keep this file short — push detail into `README.md`.

## Project

Internal staff admin console (Next.js 16 App Router, port 3500). Talks to `gp-api` through its own typed client in `src/shared/gpApi/` (`GoodPartyClient`, one resource class per gp-api surface), authenticated with gp-admin's Vercel OIDC token (see "gp-api auth" below). Access is gated by Clerk **Organizations** (Development / Production) — a single deployment targets both environments via org switch. Roles: `org:admin`, `org:sales`, `org:read_only`. See `README.md` for the auth/role/permission tables and E2E test-user setup.

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

`GoodPartyClient` sends the deployment's Vercel OIDC token from `getVercelOidcToken()` (`@vercel/oidc`, default audience) as the Bearer token, fetched for every request and never cached. With no token, building the client throws an error that names the fix. Locally, run `vercel link` and `vercel env pull` in `packages/gp-admin`: that writes `.env.local` from the Vercel Development environment, including `VERCEL_OIDC_TOKEN`. Dev gp-api accepts that `development` token. A local gp-api accepts it only once its `.env` lists `prj_ZT7POAebSPy3jFf2u0xKIUZTQpcT:development` in `VERCEL_OIDC_ADMIN_PROJECTS`.

Prod gp-api accepts only gp-admin's `production` deployment token, so a preview or local build gets a 401/403 on the Production org. `gpAction` tags a 401/403 with the `GP_API_ACCESS_DENIED` digest, and `src/app/dashboard/error.tsx` and `describeActionFailure` turn it into "switch to Development" instead of the crash page. Tokens are only read in server actions and server components; never import the client from a client component.

## 10DLC widget on the user page

`users/[id]/components/CvPinStatus.tsx` shows the Pro campaign's 10DLC stage and its SMS texting window (`smsCompliance`, `smsCutoffDate`, `generalElectionDate` from the admin compliance-state response). gp-api computes the window (`smsComplianceWindow` in `eligibility.util.ts`); never redo the date math here. A wrong cutoff is fixed by editing the campaign's election date.

## Custom office badge on the user's campaign list

`users/[id]/campaign/components/CampaignListTable.tsx` badges a Position as "Custom" when the candidate typed the office in instead of picking it from BallotReady. gp-api's M2M `GET /v1/campaigns/list` sets `positionSource` from the organization: `positionId` means `ballotready` even when staff renamed it, otherwise a `customPositionName` means `custom`. Candidate-facing reads never carry the field.

## Election result prompt on the campaign form

`users/[id]/edit/components/CampaignForm.tsx` asks staff whether to clear the last election's result when they move the election date to an upcoming one on a campaign that has one (`didWin`, `primaryResult` or `details.wonGeneral`). The answer goes to gp-api's M2M `PUT /v1/campaigns/:id` as `resetElectionResults`, and gp-api decides from it. No prompt when staff change the result in the same save. Rules: gp-api `src/payments/AGENTS.md`, "Purchase error 400 `NO_ACTIVE_CAMPAIGN`".

## Public profile card on the user page

`users/[id]/components/PublicProfileCard.tsx` shows which `/people` page the
account is linked to. When it isn't linked, staff with `write_users` get "Link
to public profile": they paste the page's link, confirm the user and the person,
and it calls `POST /v1/person-profiles/links`. That's the fix for a candidate
stuck on "still setting up your official record" because their person record
also holds a duplicate or deleted account. It never moves an existing link;
gp-api refuses that, and a person held by another user, with a message the
dialog shows as-is.

## Changing a user's email

"Change" next to the email on the user page (`users/[id]/components/ChangeEmailDialog.tsx`, `write_users`) calls gp-api's M2M `PUT /v1/users/:id/email`, which moves Clerk, the database and the HubSpot contact together, and keeps the old address on the contact as a secondary email. The edit form's email field stays read-only. When HubSpot already has another contact with the address, the dialog links both contacts so staff can merge them in HubSpot.

## Server action errors

A server action that throws reaches the browser with a redacted message in
prod. So when a staff member must read the failure (a toast), the action must
**return** the error (`{ error: string | null }`, message via
`extractApiErrorMessage`) instead of throwing; `resendCvPin` is the reference.
Client-side catches around action calls use `describeActionFailure`, which
turns deploy-skew transport failures ("Failed to find Server Action") into a
refresh hint.

## Verify

Reproduce the CI **Validate** job (`.github/workflows/gp-admin.yml`) before opening a PR. CI builds the in-tree contracts first because gp-admin consumes them. From the repo root:

```bash
npm run build -w packages/contracts        # build the in-tree contracts gp-admin imports
npm run lint -w packages/gp-admin          # eslint .
npm run test:coverage -w packages/gp-admin # vitest run --coverage
```

## Email sends page

`src/app/dashboard/email-sends/` lists paused email sends (gp-api `/admin/outreach/email`, keyed on the Outreach id) with SES's bounce and complaint rates since the last resume, and a Results column of the send's recorded counts (sent, delivered, bounced, marked as spam, opened (approximate), clicked). Resume and Cancel are `org:admin` only; Resume is hidden for `ses_tenant`, which only AWS can clear.

## SMS console: replace Peerly job

`src/app/dashboard/sms-outreach/` is the CAS approval console for Win p2p texts (gp-api `/outreach/admin/sms`). The detail page's "Replace Peerly job" (`org:admin` only) opens a two-step dialog: pick a mode and a reason (fixed choices from contracts `SMS_JOB_REPLACE_REASON_LABELS`, "Other" takes text), then a confirm step that restates what will happen. "Replace job" (not offered once the send went out) takes a new send day; gp-api cancels the current Peerly job, makes a new one on the same list and puts the campaign back under Awaiting review, so CAS approves it again to book canvassers. "Link a job from Peerly" takes the id of a job CAS already made there; gp-api checks it and repoints the campaign, carrying over a booking made in Peerly. No money moves. The rules are in gp-api `src/outreach/docs/controllers.md`.

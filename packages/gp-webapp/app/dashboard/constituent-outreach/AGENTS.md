# app/dashboard/constituent-outreach/

Serve outreach hub — the "Constituent Outreach" tab for elected officials
(epic ENG-10970). This directory is deliberately thin: a serve-gated shell
that mounts the SAME Voter Outreach 2.0 machinery the Win hub uses
(`app/dashboard/outreach/v2/`), parametrized for the Serve surface instead of
forked. If you're changing a flow, the table, the drawer, or the audience
step, the code lives in `outreach/v2/` and BOTH surfaces feel it — read
`app/dashboard/outreach/AGENTS.md` first.

## Files

| File                          | Role                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `page.tsx`                    | Server component: `serveAccess()` (redirects non-serve users; switches orgs through `/post-auth-redirect` when the user owns an eo- org that isn't selected), then fetches history via `GET /v1/outreach/serve` with `ignoreResponseError` — an empty array is a valid fresh-org response, never a 404 |
| `ConstituentOutreachPage.tsx` | Client hub: `FeatureFlagGuard` on `serve-outreach` (redirect to `/dashboard`), `OutreachProvider` seeded with the server rows, channel cards, both serve flows, the shared history table + details drawer with `fetchServeOutreachDetail` threaded in, and the same save→seed-cache handlers as Win's `OutreachHubPage` |
| `ServeChannelCards.tsx`       | The channel grid — Social media and Phone banking only. Sized to its two cards (`max-w-md grid-cols-2`), not the candidate grid's five-column breakpoints. Door knocking has no serve wiring yet and gets NO card — a permanently disabled placeholder read as broken, so it was removed until its own epic wires it |

## Connection to Win outreach — one machine, two callers

Everything interactive is `outreach/v2/` code invoked with serve parameters.
The parametrization seams (all default to the Win config, so the Win hub is
byte-identical when they're omitted):

- **`SocialFlow` / `PhoneBankingFlow` take a `surface` prop** — this page
  mounts the exported `SERVE_SOCIAL_SURFACE` and
  `SERVE_PHONE_BANKING_SURFACE` (defined next to each flow). A surface
  carries `purposes`, `nameSuggestion`, `endpoints` (and for phone banking
  `audienceCopy`). `endpoints` are bound async functions, not route strings,
  so each surface's `clientRequest` call keeps a literal `APIEndpoints` key.
- **`OutreachHistoryTable` + `OutreachDetailsDrawer` take a `detailFetcher`**
  — this page threads `fetchServeOutreachDetail`
  (`GET /v1/outreach/serve/:id`, in `outreach/v2/useOutreachDetail.ts`)
  instead of Win's campaign-scoped default.
- **`rowClickable`** scopes row clicks to `socialMedia` +
  `nativePhoneBanking` — the wired serve channels — so any other row type
  renders as plain content, never a dead clickable.
- **Purpose vocabularies** live beside Win's:
  `outreach/v2/serveSocialPurposes.ts` / `servePhoneBankingPurposes.ts`
  mirror the Win files with constituent-framed copy. Slugs deliberately reuse
  Win's strings — rows are disambiguated by scoping, not slug — and each file
  carries its own `*_PURPOSE_NAME_SUGGESTIONS` record (see the
  card-copy-vs-campaign-name gotcha in `outreach/AGENTS.md`).
- **Archive/restore is Win's endpoint unchanged** —
  `PATCH /v1/outreach/:id/archive` is already `organizationSlug`-scoped.

## The delta — Win vs Serve

| Dimension       | Win (`/dashboard/outreach`)                                                                    | Serve (this page)                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| User + scope    | Candidate with a campaign; rows keyed `campaignId`                                              | Elected official with an `ElectedOffice` row (eo- org); rows keyed `{ campaignId: null, organizationSlug }` — the isolation constraint, ENG-10976 |
| Access          | Campaign auth; per-channel Pro/compliance gates (text gate, upgrade-at-entry)                   | `serveAccess()` on the page, `@UseElectedOffice()` on the API. NO Pro gate anywhere: the `ElectedOffice` row IS the entitlement                  |
| Flags           | `voter-outreach-v2` page gate + per-channel swap flags over legacy TaskFlows                    | One `serve-outreach` flag; no legacy arm — the surface was born on v2 components. The page's `FeatureFlagGuard` is the treatment surface; the nav item reads the flag with `trackExposure: false` |
| Channels        | Social, SMS, phone banking, robocall, door knocking                                              | Social + phone banking only. Paid channels (texting, robocall) are out of scope — no compliance/payment machinery on Serve. Door knocking: no card until its serve epic |
| Endpoints       | `/v1/outreach/*`, `POST /v1/phone-banking/lists`                                                 | `/v1/outreach/serve/*` siblings, `POST /v1/phone-banking/serve/lists`                                                                            |
| Purpose slugs   | `SocialPurpose` / `PhoneBankingPurpose`                                                          | `ServeSocialPurpose` / `ServePhoneBankingPurpose` (contracts) — voter framing becomes constituent framing                                        |
| Draft grounding | Campaign story, issue positions, plan (`outreachComposeContext.service.ts`)                      | The official's Public Profile materials (`outreachServeComposeContext.service.ts`, ENG-10982) — reads by `ElectedOffice.userId`, never a campaign table |
| History list    | `GET /v1/outreach` (404s when empty)                                                             | `GET /v1/outreach/serve` (empty array is fine)                                                                                                   |

Backend details for the right-hand column — voice configs, the shared
generation services, the spine scoping — are in
`packages/gp-api/src/outreach/AGENTS.md`.

## Gotchas

- **The phone banking caller page and call-sheet PDF are one surface for
  both products.** Both hubs navigate to
  `/dashboard/outreach/phone-banking/[listId]` — deliberately shared, already
  org-scoped. The back link there can't be inferred from the URL: it reads
  `PhoneBankingList.isServe`, derived server-side from the owning org's `eo-`
  slug prefix, to point at this page instead of the Win hub (ENG-10996).
  Anything else on that page that needs to know its surface should read the
  same field, not the referrer.
- **Org switching must not replay detail queries.** `outreachDetailQueryKey`
  is not org-scoped, and the org picker's switch invalidation runs before
  `router.push` unmounts this page — a plain `invalidateQueries` refired every
  mounted detail id under the incoming org's slug header and 404'd
  (ENG-10991, both directions). `organization-picker.tsx` marks the
  `outreachDetailQueryPrefix` family stale WITHOUT refetching; keep any new
  per-org query family out of that trap the same way.
- **Nav visibility is three-way**: `serveAccessEnabled && isElectedOffice &&
  serveOutreachEnabled` in `DashboardMenu.tsx`. The route itself is
  double-gated (`serveAccess()` server-side + the flag guard client-side), so
  a hidden nav item never implies an unreachable page. The mobile title comes
  from `MOBILE_PAGE_TITLES` in `DashboardLayout.tsx`.
- **Saved rows are seeded, not refetched** — mirrors `OutreachHubPage`:
  social's save response is a full `OutreachDetail` (seed the detail cache +
  prepend), phone banking's create response is just the list (prepend an
  `in_progress` row with a client-side `createdAt` so newest-first sorting
  holds).

## Related

- `app/dashboard/outreach/AGENTS.md` — the shared v2 machinery; each flow's
  row there documents its serve parametrization.
- `packages/gp-api/src/outreach/AGENTS.md` — the serve endpoints, voice
  configs, compose grounding, and the Win/Serve isolation boundary.
- `app/dashboard/shared/serveAccess.ts` + `serveRoutes.ts` — the serve gate
  this page (and every serve route) sits behind.
- Epic: ClickUp ENG-10970 (shell + social wave + phone banking wave).

# app/dashboard/constituent-outreach/

Serve outreach hub — the "Constituent Outreach" tab for elected officials
(epic ENG-10970). This directory is deliberately thin: a serve-gated shell
that mounts the SAME Voter Outreach 2.0 machinery the Win hub uses
(`app/dashboard/outreach/v2/`), parametrized for the Serve surface instead of
forked. If you're changing a flow, the table, the drawer, or the audience
step, the code lives in `outreach/v2/` and BOTH surfaces feel it — read
`app/dashboard/outreach/AGENTS.md` first.

**Vocabulary.** This surface has regressed four times on one bug: Win nouns
reaching an elected official. They have constituents, an office and a term —
never voters, an election, a candidate or a ballot, and "campaign" only in the
outreach sense ("Campaign name" is fine, "your campaign tone" is not). Every
string here is Serve copy, and everything under `outreach/v2/` is shared, so
fix a shared string with a mode-keyed copy object rather than a rename. The
rule, the models, and the check that gates it:
**`docs/product-vocabulary.md`**.

## Files

| File                          | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `page.tsx`                    | Server component: `serveAccess()` (redirects non-serve users; switches orgs through `/post-auth-redirect` when the user owns an eo- org that isn't selected), then fetches history via `GET /v1/outreach/serve` with `ignoreResponseError` — an empty array is a valid fresh-org response, never a 404                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `ConstituentOutreachPage.tsx` | Client hub: `OutreachProvider` seeded with the server rows, channel cards, the serve flows (social, phone banking, door knocking behind `native-door-knocking`, and SMS behind `serve-sms-outreach`), the shared history table + details drawer with `fetchServeOutreachDetail` threaded in, and the same save→seed-cache handlers as Win's `OutreachHubPage`. It is also the only reader of `useServeSmsFlag()`                                                                                                                                                                                                                                                                                                                                                                                  |
| `ServeChannelCards.tsx`       | The channel grid — Social media, SMS, Phone banking and Door knocking, at `max-w-3xl grid-cols-2 sm:grid-cols-3` (four cards widen it to `max-w-4xl ... sm:grid-cols-4`, so the tiles stay the same size on either side of the SMS flag) rather than the candidate grid's five-column breakpoints. SMS renders only when the page passes an `onSmsClick`; the component itself reads no flag and stays hookless, so it needs no `'use client'`. Door knocking's card was removed for a while and is back: it had no serve wiring, and a permanently disabled placeholder reads as broken. Door knocking 3.0 wired it, and unlike the other two it navigates (`/dashboard/door-knocking?create=1`) instead of opening a flow in place — the map is its own page. Door knocking is gated separately on `showDoorKnocking` (`native-door-knocking`), so the grid can show anywhere from two to four cards |
## Connection to Win outreach — one machine, two callers

Everything interactive is `outreach/v2/` code invoked with serve parameters.
The parametrization seams (all default to the Win config, so the Win hub is
byte-identical when they're omitted):

- **`SocialFlow` / `PhoneBankingFlow` / `SmsFlow` take a `surface` prop** —
  this page mounts the exported `SERVE_SOCIAL_SURFACE`,
  `SERVE_PHONE_BANKING_SURFACE` and `SERVE_SMS_SURFACE` (defined next to each
  flow). A surface carries `purposes`, `nameSuggestion`, `endpoints` (and for
  phone banking and SMS `audienceCopy`; SMS adds `scheduleMode`,
  `composeMessage` and `ignoredStandardsRules`). `endpoints` are bound async
  functions, not route strings, so each surface's `clientRequest` call keeps
  a literal `APIEndpoints` key. `SmsFlow` gets no `tcrCompliance` here: 10DLC
  registration is a candidate committee's obligation and a Serve org has
  none, which is the same reason `SERVE_SMS_SURFACE` drops the `paid_for_by`
  standards rule.
- **`OutreachHistoryTable` + `OutreachDetailsDrawer` take a `detailFetcher`**
  — this page threads `fetchServeOutreachDetail`
  (`GET /v1/outreach/serve/:id`, in `outreach/v2/useOutreachDetail.ts`)
  instead of Win's campaign-scoped default.
- **`rowClickable`** scopes row clicks to `socialMedia`,
  `nativePhoneBanking`, `nativeDoorKnocking` and `text` — the wired serve
  channels — so any other row type (robocall) renders as plain content,
  never a dead clickable. Door knocking joined the list in 3.0, when Serve
  orgs started getting an `Outreach` envelope at all; before that a Serve
  walk produced no row for anyone to click. `text` is a Serve SMS send (the
  spine type the serve create writes — there is no Peerly `p2p` row on this
  surface) and it is deliberately NOT gated on `serve-sms-outreach`: only an
  org that has already sent has a text row, and an org whose flag is later
  turned off must not lose the results for a send it paid for. The flag
  gates the way IN, not the record of what went out.
- **Purpose vocabularies** live beside Win's:
  `outreach/v2/serveSocialPurposes.ts` / `servePhoneBankingPurposes.ts`
  mirror the Win files with constituent-framed copy. Slugs deliberately reuse
  Win's strings — rows are disambiguated by scoping, not slug — and each file
  carries its own `*_PURPOSE_NAME_SUGGESTIONS` record (see the
  card-copy-vs-campaign-name gotcha in `outreach/AGENTS.md`).
- **Archive/restore is Win's endpoint unchanged** —
  `PATCH /v1/outreach/:id/archive` is already `organizationSlug`-scoped.

## The delta — Win vs Serve

| Dimension       | Win (`/dashboard/outreach`)                                                      | Serve (this page)                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User + scope    | Candidate with a campaign; rows keyed `campaignId`                               | Elected official with an `ElectedOffice` row (eo- org); rows keyed `{ campaignId: null, organizationSlug }` — the isolation constraint, ENG-10976                                                                                                                                                                                                                                                                                                   |
| Access          | Campaign auth; per-channel Pro/compliance gates (text gate, upgrade-at-entry)    | `serveAccess()` on the page, `@UseElectedOffice()` on the API. NO Pro gate anywhere: the `ElectedOffice` row IS the entitlement                                                                                                                                                                                                                                                                                                                     |
| Channels        | Social, SMS, phone banking, robocall, door knocking                              | Social, SMS, phone banking and door knocking. Robocall stays out. SMS came in with Serve SMS (`docs/features/serve-sms.md`): it is paid per message at checkout under its own purchase type, and fulfilled by a human working a CSV rather than Peerly, so there is no 10DLC gate to clear — the `ElectedOffice` row is still the entitlement, and the flag is rollout only. Door knocking is paid in a different sense (Geoapify credits per list) |
| Endpoints       | `/v1/outreach/*`, `POST /v1/phone-banking/lists`, `POST /v1/door-knocking/turfs` | `/v1/outreach/serve/*` siblings, `POST /v1/phone-banking/serve/lists`, `POST` + `GET /v1/door-knocking/serve/turfs`                                                                                                                                                                                                                                                                                                                                 |
| Purpose slugs   | `SocialPurpose` / `PhoneBankingPurpose`                                          | `ServeSocialPurpose` / `ServePhoneBankingPurpose` (contracts) — voter framing becomes constituent framing                                                                                                                                                                                                                                                                                                                                           |
| Draft grounding | Campaign story, issue positions, plan (`outreachComposeContext.service.ts`)      | The official's Public Profile materials (`outreachServeComposeContext.service.ts`, ENG-10982) — reads by `ElectedOffice.userId`, never a campaign table                                                                                                                                                                                                                                                                                             |
| History list    | `GET /v1/outreach` (404s when empty)                                             | `GET /v1/outreach/serve` (empty array is fine)                                                                                                                                                                                                                                                                                                                                                                                                      |

Backend details for the right-hand column — voice configs, the shared
generation services, the spine scoping — are in
`packages/gp-api/src/outreach/AGENTS.md`.

## Gotchas

- **SMS is the one channel behind a flag, and `ready` is half the gate.**
  `useServeSmsFlag()` (`@shared/experiments/serveSmsFlag`, key
  `serve-sms-outreach`) returns `{ ready, enabled }` and this page mounts the
  card and the flow only on `ready && enabled`. A variant is `undefined`
  while it resolves, so gating on `enabled` alone renders three cards and
  then pops a fourth in — the flash `docs/feature-flags.md` names as the top
  anti-pattern. The flow is conditionally MOUNTED rather than rendered
  closed, so with the flag off there is no Serve SMS request reachable from
  this page by any route. gp-api gates `POST /v1/outreach/serve/sms/draft`
  and `POST /v1/outreach/serve/sms` on the same key, so the surface and the
  API roll out together — but the flag gates UX, not authz:
  `@UseElectedOffice()` is still the real check.
- **An SMS send is the one row this page refetches for, and that refetch
  must never throw.** Social and phone banking seed their new row from the
  create response; a paid text send only exists once the server finalizes it,
  so `SmsFlow`'s `onScheduled` re-reads `GET /v1/outreach/serve` the way
  `OutreachHubPage`'s `refetchOutreaches` re-reads the Win list. It is
  best-effort on two levels — `ignoreResponseError: true` (the same flag
  `page.tsx` passes on this route, since `ofetch.raw` throws on any non-2xx
  and the `ElectedOffice` can go away between the access check and the read)
  plus a try/catch for the network level. The reason is where it runs:
  `onScheduled` is awaited by `SmsFlow`'s `handleScheduled`, which is awaited
  by `SmsReviewStep`'s completion handler, whose rejection path is the
  checkout form's `onError` — an error snackbar and a payment-failure state,
  after the money has moved. A stale list beats a false payment error.
  `ConstituentOutreachPage.smsRefetch.test.tsx` pins both guards.

- **The phone banking caller page and call-sheet PDF are one surface for
  both products.** Both hubs navigate to
  `/dashboard/outreach/phone-banking/[listId]` — deliberately shared, already
  org-scoped. The back link there can't be inferred from the URL: it reads
  `PhoneBankingList.isServe`, derived server-side from the owning org's `eo-`
  slug prefix, to point at this page instead of the Win hub (ENG-10996).
  Anything else on that page that needs to know its surface should read the
  same field, not the referrer — and three things now do. The outcome form
  asks Serve's own engaged-call question (`Do they need follow-up?`, where Win
  asks support then will-vote) and persists it to `followUp`; the call-sheet
  PDF swaps the same column's heading and tick boxes off `callSheetRows(entries,
isServe)` / `answerHeading(isServe)`, because paper is the only thing a
  volunteer has on the call and must ask what the app asks; and the script's
  contact-name token is `[constituent name]` rather than `[voter name]`. A list
  frozen before any of this still carries the Win token, so every reader
  accepts either (`CONTACT_NAME_TOKENS`).
- **A completed list reports follow-up, not support.** The drawer's Results
  table reads `OutreachDetail.phoneBanking.byFollowUp` on this surface, where
  Win reads `supporters`/`unsure`/`nonSupporters`. It picks by the `isServe`
  prop and not by which tally is non-zero, so a completed list nobody answered
  still reads in Serve's words. Both keys are reported even at zero: "nobody
  needs following up" is an answer, and a row that vanished when it emptied
  would make the table's shape a fact about the list.
- **Team accounts are Win-only here.** `OutreachDetailsDrawer` takes `isServe`
  and renders no assignees section for it: the roles the assign modal offers
  are campaign roles, so an elected official gets no assignment rather than
  one in Win's vocabulary. The `win-team-accounts` flag would usually hide it
  anyway — this is the product rule, not the flag.
- **Org switching must not replay detail queries.** `outreachDetailQueryKey`
  is not org-scoped, and the org picker's switch invalidation runs before
  `router.push` unmounts this page — a plain `invalidateQueries` refired every
  mounted detail id under the incoming org's slug header and 404'd
  (ENG-10991, both directions). `organization-picker.tsx` marks the
  `outreachDetailQueryPrefix` family stale WITHOUT refetching; keep any new
  per-org query family out of that trap the same way.
- **Nav visibility mirrors page access**: `isElectedOffice` in
  `DashboardMenu.tsx`, the same elected-office existence the server-side
  `serveAccess()` gate on the route enforces. The mobile title comes from
  `MOBILE_PAGE_TITLES` in `DashboardLayout.tsx`.
- **Door knocking's card is the only one behind a feature flag, and hiding it was a bug fix rather than a rollout control.** `native-door-knocking` has a control arm on Win — the eCanvasser dashboard, which `/dashboard/door-knocking` renders with the flag off — but Serve never had one: door knocking reached this rail already native in 3.0. So a flag-off elected official pressing this card landed on a Win-only legacy screen reporting a third-party canvassing integration only a campaign can connect, all zeros, with no way back to anything. The card is hidden rather than disabled, for the same reason the placeholder before it was removed. An unsettled flag counts as off, so nothing offers a destination it cannot honour. The route itself holds the other half: `DoorKnockingPageGate` bounces an `eo-` org back here when the flag is off, so a bookmark or a stale tab cannot reach that screen either. **The two must move together** — turning the flag on for a Serve org has to restore both, and neither is a substitute for the other. The flag is read without exposure here; the page gate is the treatment surface. Win's own tile (`outreach/v2/ChannelTileGrid.tsx`) is deliberately untouched: for a candidate the eCanvasser dashboard IS the control arm.
- **Door knocking is the one channel that leaves this page, and the surface it lands on decides Win-or-Serve for itself.** The card pushes `/dashboard/door-knocking?create=1`; there is no `surface` prop to hand across a navigation. That page answers the question the same way `DoorKnockingPageGate` decides access — a `Campaign` takes precedence, an `ElectedOffice` is consulted in its absence — and holds the answer in a context (`native/doorKnockingSurface.tsx`) rather than a prop, because one route serves both. An org mid-transition therefore creates onto its Win surface even when it arrived from here, which is the safer of the two wrong answers: gp-api answers `POST /v1/door-knocking/turfs` the same way, so a list is never created onto a surface that cannot show it.
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

# app/dashboard/contacts/

Voter contact management. Browse the campaign's voter file, segment audiences, and drill into individual voter records. Powers audience selection for outreach.

This is the **unified** voter experience shared by Serve (elected office) and Win (campaign). All contacts data — list, counts, downloads, saved segments, per-person detail, the outreach timeline — is served through gp-api (`GET /v1/contacts`, the voter-file filter endpoints, and the contact-engagement endpoints). There is no raw-SQL voter path behind this route. All Win voter work goes here. See `docs/architecture.md` (voter/people data path).

## Key files

Moved to [`../../../docs/contacts-key-files.md`](../../../docs/contacts-key-files.md) (~34 KB). Grep it for the file, class, or route you are working on; do not read it whole.

## The civic panel page (`citizens-panel/`)

GoodParty builds the panel (the managed panel); officials cannot build one
themselves. The page shows the panel filling up, from
`GET /v1/contacts/civic-panel` and `GET /v1/contacts/civic-panel/managed`
(both read server-side by `page.tsx`; `progress`, `balance` and
`composition` ride on the summary). Behind `serve-citizen-panels`; copy in
`citizensPanelCopy.ts` (page) and `managedPanelCopy.ts` (Invites card,
`useServePlace`, cased by contracts' `cityNameCase`). Two
columns from `lg`, the rail under the main column on a phone; the page
pads `var(--chat-dock-height)` plus 8rem so the last card clears the bar.

- **Stage** (`stageOf` in `CitizensPanelView`): `exhausted` or `ready`
  from the managed status (ready also once members reach the goal
  without one), else `paused` from the managed status ("Your civic panel
  is paused", with Resume invites in its line, the same words as the home
  card), else `start` at 0 members, else `building`.
- **Hero** (`CivicPanelHero`): the stage's title and line
  (`COPY.hero`; building names the place, "{members} {place} residents
  are ready to share their views, on the way to {goal}."), the goal as 100 seats (`SeatArc` from `CivicPanelSeats`,
  `quiet`, on `plainSeats`: filled is members over goal, in arc order, in
  bands of the brand's three families) from `lg`, below it a `Progress`
  bar (CSS breakpoints, both always rendered; "{members} of {goal} residents
  have joined" sits over the bar only at the start, since every other
  stage's line already says it), then the four milestones, First
  yes, `PANEL_MIN_MEMBERS_FOR_BALANCE` members, Halfway and Full civic panel
  (`milestones`, from `progress.goal`, never a fixed number).
- **Who joins first** (`CivicPanelFirstJoin`) at 0 members: the first
  wave's day (`firstSendDate`, only while `wavesSent` is 0; without a
  managed panel the sentence is dropped) and what the page will show.
- **Who we're inviting next** (`CivicPanelNext`, "Groups still short" when
  exhausted) with members, a composition and the panel not ready: the 4
  rows of `shortGroups` (`panelCharts.ts`) furthest below their share, age,
  gender and race groups and places alike, in the hero's seat units
  (a group's share of 100 seats beside `memberShare` times the fill; a
  place's `buildSeats` count beside its filled), each "{have} of {need}
  seats" with a bar; See every group expands the rest in place. A tract
  shows its `label` or "A part of {place}", never its number. A label
  starts its row, so its first letter is capitalized (`capitalizeFirst`:
  "Around Calm Water Dr"); mid-sentence uses keep it as stored. This is the
  page's one answer to who's next, and it never tells the official to
  invite: GoodParty sends the invites.
- **Rail**: the Invites card (`ManagedPanelControls`, only with a managed
  panel that is not stopped): one status line, while building Next invites
  (`managedPanelNextInvitesAt`: `nextWaveAt`, else `firstSendDate` before
  the first wave) and Ready around (`readyWeekOf`, dropped once that week
  has passed), and Pause invites while building or Resume invites while
  paused through `PATCH /v1/contacts/civic-panel/managed` (ready and
  exhausted have no button). Pause is the official's only way to hold
  invites: the card never sends `stop`. A 409 from it (the
  status moved since the page loaded, like a ready civic panel that can't
  resume) reads the enrollment again and redraws the card in its real
  state, with no Try again; any other failure shows the error. Then Members
  and Ready to ask (`CitizensPanelStats showReached={false}`) and See
  members once anyone joined, which opens the built-in list's sheet led by
  its members by name (`crm/lists/CivicPanelMembers.tsx`), each opening
  `PersonOverlay`.
- **Chat**: `CivicPanelChatDock` pins the shared `FooterChatBar` and
  `ChiefOfStaffChatSurface` (`analyticsSurface` `civic_panel_dock`), the
  same dock as Ordinances and Community Issues. The bar's `placeholder` is
  this page's question, `COPY.chatPlaceholder` ("Ask who still needs to
  join your civic panel", with "civic panel" held together); a page
  placeholder may wrap to two lines on a phone instead of being cut off.
- **Analytics.** The page fires `Contacts - Civic Panel Viewed` once per visit
  (members, goal, expected answers, `howCloseStatus` from the summary's
  `balance`, snake case or null while hidden, `managedStatus` none,
  building, paused, ready, exhausted or stopped, and `source` from the
  `?from=` every in-app link adds through `civicPanelHref`:
  chief_of_staff_home, chief_of_staff_chat, contacts, outreach, else direct).
  While building it adds `groupsAtShare` (`buildBloom`) and `tractsBehind`
  (`buildSeats`). A record's `Constituent Data - Contact Viewed` carries
  `onCivicPanel`. Every join or leave
  is server truth and fires from gp-api (contacts AGENTS.md).
- **The full seats chart** (`CivicPanelSeats`) is the Constituents page
  section's (`CitizensPanelSection`), not this page's. The section leads
  with this page's count (`joinedOfGoal`, members over goal), so the two
  never disagree. The chart is the goal as 100
  seats in six rows, split by each place's district share (largest
  remainder), census tracts or, where the district has no tract data,
  precincts, named by `placeKind` ("Tract 9501.02", "Precinct 01.1") or a
  tract's human `label`. A place's members fill seats only up to its share
  (its count reads "{n} of 100 seats filled, counting each tract only up to
  its share", never a member total),
  each place one brand family cycled in arc order (`seatHue`, `seatTint`,
  fixed by position so server and client agree). From 30 members a place
  is behind when its progress is under half the panel's, outlined in
  warning and listed under "Furthest behind" (on a phone each row puts the
  name, its "X of Y seats filled" and its seats on lines of their own, so a
  long tract name wraps instead of pushing the count off screen; from `sm`
  they share one row); from 80% of the goal every
  empty seat is outlined and named or listed. The petals
  (`CivicPanelBloom`) are drawn by the priority results page. Geometry and
  allocation are pure, in `components/panelCharts.ts`. Every drawn
  coordinate goes through `roundCoord` or `polar` (hundredths): a float's
  last digit can print differently on the server and in the browser,
  which React reports as a hydration mismatch.

## Patterns

Moved to [`../../../docs/contacts-patterns.md`](../../../docs/contacts-patterns.md) (~55 KB). Grep it for the file, class, or route you are working on; do not read it whole.

## Gotchas

- Optional catch-all route (`[[...attr]]`) means `/dashboard/contacts` and `/dashboard/contacts/whatever` both render the same page — sub-routing is internal. `/dashboard/contacts/lists/<id>` is also served by the catch-all (ENG-10725 removed the literal `lists/[listId]` route); the provider’s `extractPersonIdFromPathname` explicitly returns null for the `lists` segment so it can never be fetched as a person id, and `extractListIdFromPathname` only matches exactly `lists/<id>`.
- Voter-file payloads can be huge — pagination + cursor are mandatory; never request without them.
- A feature flag gates parts of `PersonOverlay` (see `app/shared/experiments/`).
- This route is shared by Serve (elected office) and Win campaigns, and is the default Win experience (the `win-voter-data` flag was removed after the rollout hit 100%): the nav entry is added in `DashboardMenu.tsx` (`WIN_CONTACTS_MENU_ITEM`, `campaign` category) for every Win campaign, pro and non-pro. Pro gating is per-action, not page-level (ENG-10495): a non-pro Win candidate sees the real district aggregates and a blurred preview, and the Pro upgrade modal fires when they search, pick a non-default segment, open a person, or download. Backend mirrors this — `findContacts` rejects search/named-segment requests, `findPerson` rejects person-detail reads, and `downloadContacts` rejects downloads for non-pro, but the base list + `GET /v1/contacts/stats` are open to non-pro. **The base-list preview is synthetic, not real voter data (ENG-10508):** for a non-pro requester `findContacts` returns fabricated rows from `previewContacts.utils.ts` and never fetches real people rows — a frontend blur is not a real boundary (the values are copy-pastable), and our data contracts forbid sending real voter PII to non-pro users. It still reads the aggregate district stats to set the preview's `pagination.totalResults` to the real count rather than a fabricated one, while every row stays fake. The district totals the page actually renders come from `GET /v1/contacts/stats` via `districtStatsQueryOptions`, not from this response. The frontend blur on those rows is now just an upsell cue over fake data, and it covers every column (name/gender/age included) so a copy/paste test can't mistake the fabricated rows for readable real data. See **Unresolvable districts** below for the no-district case.
- **Unresolvable districts are predicted client-side, not discovered by failing.** `ContactsTableProvider` carries two signals plus their union:
  - `isDistrictUnresolvable` — proactive, `useOrganization()?.district === null`. `GET /v1/organizations` returns a resolved `district` on every org and `OrganizationProvider` loads it eagerly with SSR-seeded `initialOrganizations`; `OrganizationsService.makeFriendly` resolves it as `overrideDistrict ?? position?.district`, byte-identical to the precedence `ContactsService.resolveDistrictInfoFromOrg` uses to decide whether to 400. So a null district predicts the 400 without spending a request. Strict `=== null` (not `== null`): the `Organization` type declares `district` as a required nullable key, and an absent field should fall back to asking the server rather than hiding a page that might work.
  - `isVoterDataUnavailable` — reactive, kept because `assertVoterDataEligibility` (the federal/state voter-file rule) throws the same `VOTER_DATA_UNAVAILABLE` code from a district-carrying org and needs campaign, district, and ballotLevel together, so it can't be predicted client-side.
  - `voterDataUnavailable` — the union. Every read-path query is gated on it: the provider's `contactsQuery` (gated on the proactive predicate alone — gating on the union would let the query's own error disable the query that produced it), `useListRowDetail`, `ListDetailSheet`, and the wizard's count/overlap-count.

  The page (`crm/VoterDataUnavailableState.tsx`, support handoff to `support@goodparty.org` with the office and org slug prefilled) renders an unavailable state. **It unmounts the whole 560px column, the top bar, and `CrmAssistant` rather than disabling queries** — `DistrictStatCard` and `ListsIndex`'s `AllContactsCard` both observe the shared `['contacts-stats']` key, and React Query fires a query when ANY mounted observer is enabled, so `enabled: false` on one of them would change nothing. One known divergence: a dangling `overrideDistrictId` (set but unresolvable in the election database) makes the server proceed while the client predicts failure — the client is deliberately more conservative there.

  **The predicate lives in `app/dashboard/shared/useDistrictResolution.ts`, not in this provider.** `ContactsTableProvider` is mounted only on the contacts route, so polls (Serve), door knocking, campaign manager and onboarding cannot read its context — they call the hook directly. The provider consumes the same hook, so there is one definition of "unresolvable". **Serve is why this matters:** `canUseProFeatures` is `isPro || electedOffice`, i.e. always true for an `eo-` org, so the district gate is the only protection Serve has and the Pro gate does nothing for it.

  Every district-gated endpoint is now gated client-side: `GET /v1/contacts`, `POST /count`, `POST /overlap-count`, `GET /list-detail`, `GET /contacts/:id` (the deep link — `PersonOverlay` mounts outside the empty-state branch), `GET /contacts/download` (refused inside `useContactsDownload`, before the anchor click — it is a top-level navigation, not a fetch), `GET /contacts/stats` (all nine callers), and the door-knocking pack/turf reads. The one deliberate hole is `AudienceStep`'s **non-pro** case; its district case is gated.

  **Two traps this class of gating keeps setting.** First, `enabled: false` is not enough wherever a consumer branches on `status !== 'success'` or `isPending` to render a spinner — a disabled query is neither success nor error, so it spins forever. `useTotalConstituentsWithCellPhone` therefore returns an explicit `isUnavailable`, and every such consumer branches on that _before_ its loading branch. Second, `queryClient.prefetchQuery` ignores `enabled` entirely, so `ConfidenceAlert` gates by not calling it.

  Polls **blocks** rather than degrades (product call, 2026-08-06): a poll sent against an unknown audience cannot be priced, and `calculateRecommendedPollSize` was returning `NaN` from `MAX_CONSTITUENTS_PER_RUN - undefined` straight into the audience options and cost preview. `polls/onboarding/OnboardingPage` renders a terminal state mirroring the existing `NotEnoughConstituents` bail-out and routes to `/dashboard/contacts`, where the state above already explains the problem and offers support — so polls does not repeat the support handoff. That terminal state is checked **before** the `< 500` viability guard, which required `statsQuery.data` and so never fired for these orgs.

  `CountsInfoModal` and `PathToVictoryStep` already degraded to a hidden row, but both also `reportErrorToSentry` on failure — so a write-in office generated Sentry noise on every onboarding run. Both are gated now.

- **Naming is Win-vs-Serve and must never cross over** (ENG-10448): Win reads "Voter Data" / "voters"; Serve reads "Constituents" / "constituents". Win must never say "constituent". The strings live in one place — `app/dashboard/shared/contactsLabels.ts` (`CONTACTS_DATA_TITLE` + `getContactsLabels(isWinContext)`) — consumed by the page heading/subheading (`CrmContactsPage`), the typeahead and assistant, the lists index and list-detail sheet, the wizard, the sidebar items (`DashboardMenu`), and the mobile title (`DashboardLayout`). Add new user-facing copy through that helper, not as a local literal, so the surfaces can't drift. `filters.config.ts` section titles are the one exception the helper can't cover directly — that config renders byte-identically for door-knocking's `TurfDetailsSheet.tsx`, so it must stay untouched. `PersonOverlay.tsx`'s "Voter Demographics" `InfoSection` heading (Serve-visible) is still a hardcoded literal and needs the same treatment if that surface is ever touched.

## Analytics

Moved to [`../../../docs/contacts-analytics.md`](../../../docs/contacts-analytics.md) (~10 KB). Grep it for the file, class, or route you are working on; do not read it whole.

## Related

- `helpers/createVoterFileFilter.ts` — filter payload builder.
- `app/dashboard/outreach/` — consumer of saved segments.
- `gpApi/api-endpoints.ts` — voter-file endpoints.
- `packages/gp-api/src/contacts/CLAUDE.md` — the system-level CRM doc: backend flows (filter resolution, materialization, write-back sweeps, assistant tools), data model, and the debugging playbook.

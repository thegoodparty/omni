# app/dashboard/contacts/

Voter contact management. Browse the campaign's voter file, segment audiences, and drill into individual voter records. Powers audience selection for outreach.

This is the **unified** voter experience shared by Serve (elected office) and Win (campaign). All contacts data — list, counts, downloads, saved segments, per-person detail, the outreach timeline — is served through gp-api (`GET /v1/contacts`, the voter-file filter endpoints, and the contact-engagement endpoints). There is no raw-SQL voter path behind this route. All Win voter work goes here. See `docs/architecture.md` (voter/people data path).

## Key files

Moved to [`../../../docs/contacts-key-files.md`](../../../docs/contacts-key-files.md) (~34 KB). Grep it for the file, class, or route you are working on; do not read it whole.

## The civic panel page (`citizens-panel/`)

GoodParty builds the panel (the managed panel, `ManagedPanelControls` with
its Pause, Resume and Stop); officials cannot build one themselves. The page
shows where it stands, from `GET /v1/contacts/civic-panel` (read
server-side by `page.tsx`; `progress`, `balance` and `composition` ride on
the summary). Behind `serve-citizen-panels`; copy in `citizensPanelCopy.ts`.

- **Analytics.** The page fires `Civic Panel - Panel Viewed` once per visit
  (members, goal, expected answers, `howCloseStatus` from the summary's
  `balance`, snake case or null while hidden, and `entry` from the `?from=`
  every in-app link adds through `civicPanelHref`: chief_of_staff_home,
  chief_of_staff_chat, contacts, outreach, else direct). Every join or leave
  is server truth and fires from gp-api (contacts AGENTS.md).

- **Milestones, at the top** (`CivicPanelMilestones`): a card with a title and one line for where the panel stands
  (Your panel starts here, Your panel has started, Your panel is growing,
  Halfway there, Almost there), then four milestones, First yes,
  `PANEL_MIN_MEMBERS_FOR_BALANCE` members, Halfway and Full panel, each done,
  next or not yet. Halfway and full come from the API's `progress.goal`,
  never a fixed number. The line names how many places keep pace (not
  behind) or, from 80% of the goal, the seats to go, from the summary's
  `composition`; without one it is the members alone. Past the goal with
  every seat filled it turns into the full panel: "Every seat is filled",
  the members, places and `groupsCovered` of `groupsTotal` groups, and "Ask
  your panel a question" to the Priorities page, where a question to the
  panel starts. No answer count anywhere on the page. The full panel's group
  figure is the petals' own count ("N of M groups at their share", from
  `buildBloom` on `composition.groups`), never the API's `groupsCovered` of
  `groupsTotal`, which also counts tracts and so would disagree with the
  petals; without groups there is no figure. The Constituents page's
  `CitizensPanelSection` draws the same `CivicPanelSeats` above its numbers,
  from the same summary read.
- **How your panel compares with your district** (`CivicPanelBalance.tsx`,
  from the summary's `balance`; hidden when it is null): the
  panel's own status and dot (`CIVIC_PANEL_BALANCE_STATUS_LABELS`: Too few
  members yet, Missing some groups, Every group on your panel; never the
  priority's labels), then one line, "Invite more {group} next." from
  `inviteMore`, or for Too few members yet "We'll compare your panel with
  your district once 30 people join." Past the goal the API also sends
  `groupsNeedingFresh` (groups short of members who answered in the last 90
  days) and the status reads "Every group on your panel · 3 groups need fresh
  voices", with "Invite more {group} next." naming the thinnest, or "Every
  group has fresh voices" once none are short. Never a share, weight or target. Once the
  panel can be compared, the section also draws each group as a petal
  (`CivicPanelBloom`, from the summary's `composition.groups`): its length is
  members share over district share, capped at twice, a ring at even, over
  in primary, under in warning, within a fifth of even neutral, "N of M at
  their share" in the middle and "About its share" or "X% of its share" by
  each petal (a list under it on a phone). **The page names one next step**:
  the status line's "Invite more {group} next.", from the API's
  `inviteMore`, which is the group the next draw leans toward
  (`PanelSteering.leansToward`). Neither chart names anyone to invite: the
  petals add only "Every group has its share." when the status names nobody
  and no petal is under, and the seats list who is behind without a next
  line. Only this page shows the status.
- **The aside** (beside the panel from `lg`, below it on a phone, with any
  member): the members, reached and can be asked now figures and See
  members.
- The seats sit under the balance (`CivicPanelSeats`, from the summary's
  `composition.places`, hidden without one): the goal as 100 seats in six
  rows, split by each place's district share (largest remainder), census
  tracts or, where the district has no tract data, precincts, named by
  `placeKind` ("Tract 9501.02", "Precinct 01.1"). A tract with a human
  name shows it instead (the place's `label` from gp-api: "West Asheville",
  "around Haywood Rd"), in the seats' labels and the Furthest behind and
  Most empty seats rows alike. Rows truncate with the whole name as a
  tooltip; around the arc a name is cut to 14 characters, the whole name
  in its `<title>`. A place's members fill
  seats only up to its share of the goal. Filled seats take the brand's
  red, blue and lavender: each place one family, cycled in arc order so
  neighbors differ, its seats three tints of it outlined in the darkest
  (`seatHue`, `seatTint`, fixed by position so server and client agree).
  From 30 members a place is behind
  when its progress is under half the panel's, outlined in warning and
  listed under "Furthest behind" (up to 5, with "N of M tracts are behind
  the rest."); under 30 the wait
  line shows. From 80% of the goal every empty seat is outlined: with 12 or
  fewer places each is named around the arc (a list on a phone), with more
  the five with the most empty seats are listed. All filled reads "Every
  tract has its share of seats filled." Geometry and allocation are pure,
  in `components/panelCharts.ts`. Both charts are SVG scaled by viewBox, so
  they fit a 375px phone. Every drawn coordinate goes through `roundCoord`
  or `polar` (hundredths): a float's last digit can print differently on
  the server and in the browser, which React reports as a hydration
  mismatch.

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

  The page (`crm/VoterDataUnavailableState.tsx`, support handoff to `support@goodparty.org` with the office and org slug prefilled) renders an unavailable state. **It unmounts the whole 560px column, the top bar, and `CrmAssistant` rather than disabling queries** — `DistrictStatCard` and `ListsIndex`'s `AllContactsCard` both observe the shared `['contacts-stats']` key, and React Query fires a query when ANY mounted observer is enabled, so `enabled: false` on one of them would change nothing. One known divergence: a dangling `overrideDistrictId` (set but unresolvable in election-api) makes the server proceed while the client predicts failure — the client is deliberately more conservative there.

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

# app/dashboard/contacts/

Voter contact management. Browse the campaign's voter file, segment audiences, and drill into individual voter records. Powers audience selection for outreach.

This is the **unified, People-API-backed** voter experience shared by Serve (elected office) and Win (campaign). All contacts data — list, counts, downloads, saved segments, per-person detail, the outreach timeline — is served by people-api through gp-api (`GET /v1/contacts`, the voter-file filter endpoints, and the contact-engagement endpoints). There is no raw-SQL voter path behind this route. Win access is the new home for what the legacy `dashboard/voter-records/` page used to serve; that page still exists for un-migrated Win users until the post-rollout cleanup (ENG-10436), but new Win voter work goes here. See `docs/architecture.md` (voter/people data path).

## Key files

| File                               | Role                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `[[...attr]]/page.tsx`             | Single catch-all route — sub-views are query/path slugs handled inside |
| `[[...attr]]/components/`          | Top-level layout + tab content                                         |
| `[[...attr]]/components/segments/` | Saved audience segments (list, create, edit)                           |
| `[[...attr]]/components/person/`   | Individual voter detail (`PersonOverlay.tsx`)                          |
| `[[...attr]]/components/configs/`  | Filter / column configuration UI                                       |
| `[[...attr]]/components/shared/`   | Cross-tab primitives (table, filter chips)                             |
| `[[...attr]]/hooks/`               | Data fetching hooks for voter file pages                               |

## Patterns

- **One catch-all route** (`[[...attr]]`) — all "tabs" (people, segments, settings) are handled inside that route's components, not as separate Next.js routes. Easier to share filter state.
- **Filters and segments are distinct**: filters are ephemeral (current view); segments are saved (named, reused in outreach). Don't conflate.
- **Voter file fetching** uses `helpers/createVoterFileFilter.ts` to build the filter payload — keep that helper as the single shape source.
- The `PersonOverlay` is a side-panel detail view that opens over the table; route-level navigation isn't used to drill in.

## Gotchas

- Optional catch-all route (`[[...attr]]`) means `/dashboard/contacts` and `/dashboard/contacts/whatever` both render the same page — sub-routing is internal.
- Voter-file payloads can be huge — pagination + cursor are mandatory; never request without them.
- A feature flag gates parts of `PersonOverlay` (see `app/shared/experiments/`).
- This route is shared by Serve (elected office) and Win campaigns. Win access is gated by the `win-voter-data` flag alone (pro and non-pro): the nav entry is added in `DashboardMenu.tsx` (`WIN_CONTACTS_MENU_ITEM`, `campaign` category) for any flag-on Win campaign, and gp-api's `assertContactsAccess` enforces the flag, not pro. Pro gating is per-action, not page-level (ENG-10495): a non-pro Win candidate sees the real district aggregates and a blurred preview, and the Pro upgrade modal fires when they search, pick a non-default segment, open a person, or download. Backend mirrors this — `findContacts` rejects search/named-segment requests, `findPerson` rejects person-detail reads, and `downloadContacts` rejects downloads for non-pro, but the base list + `GET /v1/contacts/stats` are open to flag-on non-pro. **The base-list preview is synthetic, not real voter data (ENG-10508):** for a non-pro requester `findContacts` returns fabricated rows from `previewContacts.utils.ts` and never fetches real people rows — a frontend blur is not a real boundary (the values are copy-pastable), and our data contracts forbid sending real voter PII to non-pro users. It still reads the aggregate district stats to set the preview's `pagination.totalResults` to the real count, because the unblurred "Total Voters" stat card derives from `totalResults` (`stats.util.ts`) — so the number a non-pro user sees doesn't regress, while every row stays fake. The frontend blur on those rows is now just an upsell cue over fake data. A Win campaign with no resolvable district gets a `400 { errorCode: 'VOTER_DATA_UNAVAILABLE' }`, which `ContactsTableProvider` surfaces as `isVoterDataUnavailable` so `ContactsPage` renders a clean ineligible state instead of an error.
- **Naming is Win-vs-Serve and must never cross over** (ENG-10448): Win reads "Voter Data" / "voters"; Serve reads "Constituent Data" / "constituents". Win must never say "constituent". The strings live in one place — `app/dashboard/shared/contactsLabels.ts` (`CONTACTS_DATA_TITLE` + `getContactsLabels(isWinContext)`) — consumed by the page heading/subheading (`ContactsPage`), stat labels (`ContactsStatsSection`), the sidebar items (`DashboardMenu`), and the mobile title (`DashboardLayout`). Add new user-facing copy through that helper, not as a local literal, so the surfaces can't drift.

## Analytics

Events live under the `Contacts` group in `helpers/analyticsHelper.ts` and fire frontend (screen views and user clicks the browser directly observes). Every event carries a `context: 'win' | 'serve'` property sourced from the provider's `isWinContext` — so Win adoption of the unified path is a property filter in Amplitude, not a duplicate event set. Don't mint per-context events.

- `Contacts - Contacts Viewed` — fires once on page entry (`ContactsPage`), `context` only.
- `Contacts - Outreach Timeline Viewed` — Win-only; fires when the Win outreach timeline renders rows in `PersonOverlay` (`context: 'win'`, `personId`). Not fired for an empty feed or the Serve poll-interaction timeline.
- `Contacts - Download` / `Segment Viewed` / `Segment Created` / `Segment Updated` / `Segment Deleted` — existing events, now carrying `context`.

Source the `context` from `isWinContext` (single source of truth in `ContactsTableProvider`) — don't recompute Win-vs-Serve. New events: follow `.claude/skills/instrument-analytics-event/SKILL.md`.

## Related

- `helpers/createVoterFileFilter.ts` — filter payload builder.
- `app/dashboard/outreach/` — consumer of saved segments.
- `gpApi/api-endpoints.ts` — voter-file endpoints.
- `app/dashboard/voter-records/CLAUDE.md` — the legacy Win voter-file page this route supersedes (still live until ENG-10436).

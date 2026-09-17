# Community Issues — Serve dashboard pages

List and detail pages for the agent-generated community issue feed. Only visible to
elected-official (Serve) users; access is gated by `serveAccess()`.

## Pages

| Route                                  | File                 | What it does                                                                                                   |
| -------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `/dashboard/community-issues`          | `page.tsx`           | Fetches both feed lists (`top_community` + `trending`) via `GET /v1/community-issues`; renders `IssueFeedList` |
| `/dashboard/community-issues/all`      | `all/page.tsx`       | Full `top_community` list (the "View all issues" target)                                                       |
| `/dashboard/community-issues/trending` | `trending/page.tsx`  | Full `trending` list (the "View all" target)                                                                   |
| `/dashboard/community-issues/:id`      | `[issueId]/page.tsx` | Fetches issue detail via `GET /v1/community-issues/:id`; renders `IssueDetail`                                 |
| `/dashboard/community-issues/:id/affected-residents` | `[issueId]/affected-residents/page.tsx` | That issue's affected-residents list + map. Behind `FeatureFlagGuard` on `serve-affected-residents` |

## Key components

| Component                       | Purpose                                                                                                                                                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IssueFeedList`                 | List view — a compact "Trending now" card on top, then a continuous numbered "Top community issues" card                                                                                                                                                       |
| `IssueCard`                     | One issue row (rank circle, title, summary, priority pill, "See details"); exports `priorityVariant` + `issueHref`                                                                                                                                             |
| `IssuesNavHeader`               | The flag + "Community Issues" header bar shared across the list, sub-list, and detail pages                                                                                                                                                                    |
| `IssueDetail`                   | Full detail view — detail sections (overview, history, legislation, research, quotes) with inline source pills and a collapsible sources panel                                                                                                                 |
| `PrioritizeButton`              | Calls `POST /v1/community-issues/:id/prioritize`; on success flips the header to a "✓ Added" confirmation + "My priority" pill                                                                                                                                 |
| `CommunityIssuesChatDock`       | Footer CoS chat bar; on detail pages also wires text-selection → "Ask AI" so a highlighted passage anchors the conversation                                                                                                                                    |
| `categoryDisplay`               | Maps a `CommunityIssueCategory` to its approved icon + label                                                                                                                                                                                                   |
| `StaffDispatchButtons`          | Staff-only (`@goodparty.org` email) buttons on the list page that manually dispatch the two agent jobs for the caller's own org via `POST /v1/community-issues/self-dispatch`. Renders `null` for everyone else. The endpoint re-checks the email server-side. |
| `CommunityIssuesDispatchBanner` | Non-blocking landing catch-up: calls `POST /v1/community-issues/dispatch-if-needed` on mount and polls `GET /v1/community-issues` (both lists) while either `refresh.status === 'running'`, then clears.                                                       |

## Affected residents (feature-flagged)

`serve-affected-residents` gates a second surface hanging off **one issue**: the
ranked, contactable residents most materially affected by it, plus a map.

| Component               | Purpose                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `AffectedResidentsView` | Header, the affectedness read, map, "how this list was built", the collapsible caveats panel, and the ranked table (100 rows at a time) |
| `AffectedResidentsMap`  | Google Maps render of the list, grouped by coordinate                                                            |

The entry point is a `NextStepCard` inside `IssueDetail`, gated on the flag and
on the issue actually having a list.

Things that are easy to break:

- **The flag is not the access control.** gp-api resolves the issue with
  `where { id, organizationSlug }` before it reads the bucket and returns null
  for anyone else, so turning the flag on for an office with no list shows
  nothing and turning it on for the wrong office shows nothing either. Gate UX
  with the flag; never rely on it for authz.
- **The columns are driven by the list, not hardcoded.** Factors are per-issue,
  so the table renders one score column per declared factor. A rezoning scored
  on proximity/tenure/income and a dwelling-type segment scored on a unit
  designator share no columns.
- **A `null` factor score is a dropped factor, not a low one.** It renders as a
  dash and the note above the table says so, with the per-factor missing counts
  computed from the list rather than written down. Never format it as `0.00`.
- **`confidence` is epistemic and never the score.** It is how sure we are the
  resident belongs in the segment at all, shown in its own column with the
  reason on hover.
- **An age carries its basis.** L2 uses a year-only placeholder on a large share
  of records, so a year-only age renders as `29 (±1)`. An age filter that looks
  exact is not.
- **The detail page resolves the count server-side** and passes only
  `affectedResidentCount` into the client, so the browser never receives the
  residents just to decide whether to draw a link. Keep it that way. The cost
  is that it pulls the whole list from gp-api to read one field; gp-api caches
  per issue, so the onward navigation is free. Add a count-only route if that
  ever gets expensive.
- **With the flag off, the list page still sends the caller their own list.**
  `FeatureFlagGuard` is client-side, so the props are in the RSC payload before
  the guard decides to render nothing. Not a leak — it is their own office's
  data — but the flag is not a transport-level gate.

The map follows the runbook's own Leaflet conventions so a new one matches
rather than approximates: a four-bin purple ramp
(`#e3e0ee #b3a2c7 #8265ac #54278f`) over equal-width bins between the list's
min and max score, and a marker radius growing with the number of residents at
the point. It groups **by coordinate, not by address string** — every unit in
an apartment building shares one lat/lon in L2, so grouping by address stacks
coincident markers on one building and breaks the size convention.

It draws **no anchor and no segment outline**, deliberately. Only some issues
have a point to measure from, and an outline around a boundary that was
inferred rather than published asserts a precision that does not exist; the
per-resident confidence note is the honest place for that.

## Citation reuse

`IssueDetail` reuses `app/shared/citations/` (`SectionSourcePills`, `SourcesCollapsible`)
— the same components used in meeting briefings. Sources are threaded from the issue's
`detail.sources` array; `source_ids` on each section drive the inline pill display.

## API endpoint

All data reads from `GET /v1/community-issues` (list), `GET /v1/community-issues/:id` (detail),
and `GET /v1/community-issues/:id/affected-residents` (the flagged list + map),
backed by `packages/gp-api/src/communityIssues/`.

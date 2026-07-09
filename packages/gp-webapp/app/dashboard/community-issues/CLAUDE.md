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

## Citation reuse

`IssueDetail` reuses `app/shared/citations/` (`SectionSourcePills`, `SourcesCollapsible`)
— the same components used in meeting briefings. Sources are threaded from the issue's
`detail.sources` array; `source_ids` on each section drive the inline pill display.

## API endpoint

All data reads from `GET /v1/community-issues` (list) and `GET /v1/community-issues/:id` (detail),
backed by `packages/gp-api/src/communityIssues/`.

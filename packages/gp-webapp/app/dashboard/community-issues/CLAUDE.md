# Community Issues — Serve dashboard pages

List and detail pages for the agent-generated community issue feed. Only visible to
elected-official (Serve) users; access is gated by `serveAccess()`.

## Pages

| Route                             | File                 | What it does                                                                                                   |
| --------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `/dashboard/community-issues`     | `page.tsx`           | Fetches both feed lists (`top_community` + `trending`) via `GET /v1/community-issues`; renders `IssueFeedList` |
| `/dashboard/community-issues/:id` | `[issueId]/page.tsx` | Fetches issue detail via `GET /v1/community-issues/:id`; renders `IssueDetail`                                 |

## Key components

| Component              | Purpose                                                                                                                                                                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IssueFeedList`        | Tabbed list view — top-community tab + trending tab; shows refresh status                                                                                                                                                                                      |
| `IssueDetail`          | Full detail view — detail sections (overview, history, legislation, research, quotes) with inline source pills and a collapsible sources panel                                                                                                                 |
| `PrioritizeButton`     | Calls `POST /v1/community-issues/:id/prioritize`; adds issue to the org's Priorities list                                                                                                                                                                      |
| `AskAiButton`          | Opens the CoS chat pre-anchored to the issue context                                                                                                                                                                                                           |
| `IssueDetailActions`   | Action row: Prioritize + Ask AI + "Run a poll" link to `/dashboard/polls/create?issue=:id`                                                                                                                                                                     |
| `StaffDispatchButtons` | Staff-only (`@goodparty.org` email) buttons on the list page that manually dispatch the two agent jobs for the caller's own org via `POST /v1/community-issues/self-dispatch`. Renders `null` for everyone else. The endpoint re-checks the email server-side. |

## Citation reuse

`IssueDetail` reuses `app/shared/citations/` (`SectionSourcePills`, `SourcesCollapsible`)
— the same components used in meeting briefings. Sources are threaded from the issue's
`detail.sources` array; `source_ids` on each section drive the inline pill display.

## API endpoint

All data reads from `GET /v1/community-issues` (list) and `GET /v1/community-issues/:id` (detail),
backed by `packages/gp-api/src/communityIssues/`.

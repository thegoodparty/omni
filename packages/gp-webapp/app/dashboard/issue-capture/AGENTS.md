# app/dashboard/issue-capture/

"What we heard": one effort's report. An effort is a door-knocking turf's or a
phone list's `Outreach` envelope, and the report shows what people said on it,
as ranked themes once there are enough confirmed notes. Both products, each on
its own flag. The API is `packages/gp-api/src/constituentFeedback/`; shapes are
`@goodparty_org/contracts` `constituentFeedback/FeedbackSynthesis.schema.ts`.

## Files

| File                                                     | Role                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| `issueCaptureAccess.ts`                                  | The server gate every page calls; returns `isServe`           |
| `[outreachId]/page.tsx`                                  | The report route                                              |
| `[outreachId]/theme/[themeId]/page.tsx`                  | One theme                                                     |
| `[outreachId]/queries.ts`                                | Report (polls while a run is in flight), theme, proposed tags |
| `[outreachId]/components/WhatWeHeardPage.tsx`            | The report's client boundary and its four states              |
| `[outreachId]/components/SummarizeButton.tsx`            | "Summarize what we heard" and its refusals                    |
| `[outreachId]/components/ThemeGrid.tsx`, `ThemeCard.tsx` | Ranked cards                                                  |
| `[outreachId]/components/MemoList.tsx`                   | The notes, on the report and as a theme's members             |
| `[outreachId]/components/NewTagsStrip.tsx`               | Proposed tags to accept or dismiss                            |
| `copy.ts`                                                | Every string, mode-keyed                                      |
| `analytics.ts`                                           | The `channel` value each effort reports under                 |
| `WhatWeHeardLink.tsx`                                    | The entry row on the turf and the phone list                  |
| `WhatWeHeardAction.tsx`                                  | The outreach drawer's link, at any status                     |

## Access

`issueCaptureAccess()` runs `candidateAccess()` (signed in, in an org, not a
volunteer: the gate the phone caller uses for both products), then reads the
product's flag server-side with `getFlagVariants`. The flag is chosen by the
`organization-slug` cookie's `eo-` prefix, the way gp-api's
`issueCaptureFlagFor` chooses it, so the page and its routes roll out
together. Flag off redirects to `/dashboard` before anything renders. No nav
entry: the page is reached from the effort.

## The four states

`WhatWeHeardPage` renders them in this order of precedence:

1. **A run in flight**: `SummarizingBanner` with every note under it, and no
   button. `reportQueryOptions` polls every 5 seconds while `run.status` is
   `running` and stops by itself.
2. **Under the floor** (`confirmed < floor`): `UnderFloorList`, "What people
   said so far" and "Themes appear after {floor} confirmed notes." `floor`
   comes from the report; never write the number. It beats a completed run
   because counts are read live and a memo can lose its confirmation.
3. **Completed**: `NewTagsStrip`, then `ThemeGrid`, then "Every note".
4. **Failed**: "We couldn't summarize this time." over the previous run's
   themes, if there are any.

With no run and enough notes, it shows the button and every note. The button
shows whenever no run is in flight. It is off under the floor (the list
already says why), and off with the reason as helper text after a 422 or 429.
A 409 just refetches, since the report will show the run.

## Rules

- **The caption states every denominator**: "84 people answered. 61 left a
  note. 54 confirmed, 7 waiting for review." The last clause drops when
  nothing is pending. Only confirmed notes enter a theme, and the caption is
  what stops a card's count being read as more than it is. The pending count
  is plain text until a review page exists to link it to.
- **Cards rank by `conversationCount`**, the run's `rank` breaking ties: the
  issue several people raised rises. A count is "conversations that touched
  this theme", never a share, since one note can sit in two themes. The stance
  split is four counts, not a chart, for the same reason.
- **Every note is labeled as the canvasser's summary** ("Summary by ..."),
  never quoted as the other person's words. A pending note says "Not yet
  reviewed". A theme's members are confirmed only.
- **Copy is mode-keyed in `copy.ts`.** Win says voters and never constituent,
  Serve says constituents and never voter, and nothing says poll, survey,
  representative or statistically significant.
  `WhatWeHeardPage.test.tsx` and `ThemeDetailPage.test.tsx` assert all three
  across every state.
- **Copied from `polls/`, not imported.** The cards and the theme page are
  adapted from `polls/[id]/components/PollsIssue*` and
  `polls/[id]/issue/[issueIndex]/components/*`. Polls' providers are
  poll-typed and server-fed; here the data is React Query, so components take
  props.
- **The tags strip is the manager's.** `GET tags?status=proposed` is
  owner-or-manager, so a 403 renders nothing (`retry: false`). It reads fresh
  on every mount (`staleTime: 0`), because a run landing while the page is
  open proposes new tags. Accept is `PATCH { action: 'accept' }`, Dismiss is
  `{ action: 'retire' }`, and both invalidate the report.

## Entry points

`WhatWeHeardLink` reads `N conversations · M notes` from the report and links
to it. It renders nothing while the product's flag is off (read without
exposure: the capture card is the treatment), when there is no envelope, or
until somebody has answered. It does not poll.

- **Turf**: `TurfSummaryRow` fills `TurfSummaryCard`'s `heard` slot with it,
  keyed on `turf.outreachId`, and `TurfDetailsSheet` carries it under
  Progress. See `door-knocking/AGENTS.md`.
- **Phone list**: the caller page shows it under its title bar, manager
  surface only. The list read carries no envelope, so the outreach drawer's
  Continue calling and the create flow's Go to call list pass it as
  `?outreachId=`. See `outreach/AGENTS.md`.
- **Outreach drawer**: `WhatWeHeardAction` is the drawer's own way in, at
  any status, which is what reaches a finished list (its drawer has no
  Continue calling). It reads only the flag, not the report, so opening a
  drawer costs no request. A phone row links its own id. A door-knocking
  row links only when the campaign is one turf, to that turf's envelope: a
  report is per turf and the row's id names just the anchor's, so a
  several-turf campaign leaves it to the turf cards.

The person record (`contacts/crm/person/ConstituentFeedbackSection.tsx`)
shows each memo's accepted tags as badges under it.

## Analytics

`EVENTS.IssueCapture`, `product` on every event, and `channel` as
`doorKnocking` or `phoneBanking` (`analytics.ts`) to match the capture
events. Counts only, never a memo's words or a tag's name.

| Event                | Fires                               | Properties                                                   |
| -------------------- | ----------------------------------- | ------------------------------------------------------------ |
| `ReportViewed`       | Once per visit, on the first report | `scope: 'effort'`, `channel`, `themeCount`, `confirmedCount` |
| `SynthesisRequested` | On the button's press               | `scope: 'effort'`, `channel`, `confirmedCount`               |
| `TagAccepted`        | After an accept lands               | `source: 'report'` (the surface it was accepted on)          |

# app/dashboard/issue-capture/

"What we heard": one effort's report. An effort is a door-knocking turf's or a
phone list's `Outreach` envelope, and the report shows what people said on it,
as ranked themes once there are enough confirmed notes. Both products, on one
flag, `issue-capture`. The API is `packages/gp-api/src/constituentFeedback/`; shapes are
`@goodparty_org/contracts` `constituentFeedback/FeedbackSynthesis.schema.ts`.

## Files

| File                                                     | Role                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| `issueCaptureAccess.ts`                                  | The server gates (dashboard, and flag only); return `isServe`  |
| `[outreachId]/page.tsx`                                  | The report route                                               |
| `[outreachId]/theme/[themeId]/page.tsx`                  | One theme                                                      |
| `[outreachId]/queries.ts`                                | Report and review list (each polls while waiting), theme, tags |
| `[outreachId]/components/WhatWeHeardPage.tsx`            | The report's client boundary and its four states               |
| `[outreachId]/components/SummarizeButton.tsx`            | "Summarize what we heard" and its refusals                     |
| `[outreachId]/components/ThemeGrid.tsx`, `ThemeCard.tsx` | Ranked cards                                                   |
| `[outreachId]/components/MemoList.tsx`                   | The notes, on the report and as a theme's members              |
| `[outreachId]/components/NewTagsStrip.tsx`               | Proposed tags to accept or dismiss                             |
| `[outreachId]/review/page.tsx`                           | "Notes to review": the effort's unconfirmed memos              |
| `[outreachId]/review/components/PendingMemoList.tsx`     | The review list, its retry and its typed re-record             |
| `copy.ts`                                                | Every string, mode-keyed                                       |
| `analytics.ts`                                           | The `channel` value each effort reports under                  |
| `WhatWeHeardLink.tsx`                                    | The entry row on the turf and the phone list                   |
| `NotesToReviewLink.tsx`                                  | "Notes to review: N" on the turf sheet and volunteer walk      |
| `WhatWeHeardAction.tsx`                                  | The outreach drawer's link, at any status                      |

## Access

`issueCaptureAccess()` runs `candidateAccess()` (signed in, in an org, not a
volunteer: the gate the phone caller uses for both products), then reads
`issue-capture` server-side with `getFlagVariants`, the key gp-api gates the
routes on, so the page and its routes roll out together. The
`organization-slug` cookie's `eo-` prefix picks the product's words. Flag off
redirects to `/dashboard` before anything renders. No nav
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
Neither refusal outlives the report it was made against: a new run or a new
confirmed count resets the button, and a 429, which changes nothing on the
report and so does not re-read it, lifts on the report's next read. A 409
just refetches, since the report will show the run. `SynthesisRequested`
fires on the press, refused or not.

## Rules

- **The caption states every denominator**: "84 people answered. 61 left a
  note. 54 confirmed, 7 waiting for review." The last clause drops when
  nothing is pending, and links to the review page when something is. Only
  confirmed notes enter a theme, and the caption is what stops a card's
  count being read as more than it is.
- **Cards rank by `conversationCount`**, the run's `rank` breaking ties: the
  issue several people raised rises. A count is "conversations that touched
  this theme", never a share, since one note can sit in two themes. The stance
  split is four counts, not a chart, for the same reason. It counts every
  issue raised in the theme's notes, so a note that raised two issues
  contributes two and the split can sum past the conversation count (interim,
  until membership is per issue; `packages/gp-api/src/constituentFeedback/AGENTS.md`).
- **Every note is labeled as the canvasser's summary** ("Summary by ..."),
  never quoted as the other person's words, with its issues listed under it
  (`MemoList`). A pending note says "Not yet reviewed". A theme's members are
  confirmed only.
- **Copy is mode-keyed in `copy.ts`.** Win says voters and never constituent,
  Serve says constituents and never voter, and nothing says poll, survey,
  representative or statistically significant.
  `WhatWeHeardPage.test.tsx` and `ThemeDetailPage.test.tsx` assert all three
  across every state.
- **The report links back to the hub, not just the sidebar.** Polls' own back arrow is commented out, so the copy would have had none. Win's link carries `?outreachId=` so `/dashboard/outreach` reopens this effort's drawer; Serve's hub takes no such parameter and gets the plain path. The theme page links back to the report and the review page does the same.
- **Copied from `polls/`, not imported.** The cards and the theme page are
  adapted from `polls/[id]/components/PollsIssue*` and
  `polls/[id]/issue/[issueIndex]/components/*`. Polls' providers are
  poll-typed and server-fed; here the data is React Query, so components take
  props.
- **The tags strip is the manager's.** `GET tags?status=proposed` is
  owner-or-manager, so a 403 renders nothing (`retry: false`). It reads fresh
  on every mount (`staleTime: 0`), because a run landing while the page is
  open proposes new tags. The list is the org's, so the strip keeps only the
  proposed tags of the themes on the page (`report.themes[].tag`), never
  another effort's. It goes by the themes, not `report.run`, because that
  run can be failed or in flight while the themes come from the last
  completed one. Accept is `PATCH { action: 'accept' }`, Dismiss is
  `{ action: 'retire' }`, and both invalidate the report.

## Notes to review

`[outreachId]/review` lists the effort's unconfirmed memos
(`GET pending?outreachId=`, newest first; gp-api gives a volunteer only
their own). Each is the canvasser's summary with, under it:

- **Still transcribing** (`extractionStatus: pending`): the line and nothing
  else. Every row without an extraction, transcribing or failed, is headed
  "Recorded by ..." rather than "Summary by ...", since there is no summary
  to credit. The query polls every 5 seconds while one is in this state.
- **Extracted**: `IssueCaptureConfirmCard` with the proposed issues, and no
  Skip: leaving the page leaves the note unconfirmed. See
  `door-knocking/AGENTS.md` for how the card edits and removes issues.
- **Failed**: what went wrong ("couldn't make out" with no transcript,
  "couldn't pull anything" with one), "Try again" (`POST :id/retry`, which
  transcribes or extracts again) and "Type it instead", which opens a text
  field and re-records the memo as typed text (`POST /v1/constituent-feedback`
  with the item's `reference` and `clientKey`, `captureMethod: typed`). The
  re-read then shows the extracted card. Typed text has to become the
  transcript, because synthesis groups transcripts: a row with only
  confirmed issues never reaches a theme. No typing when `reference` is null.

A confirm fires `PendingMemoConfirmed` and re-reads the list and the
report. Each row has a polite `role="status"` line that reads "Still
transcribing" and then "Ready to review", so a card arriving while the page
is open is announced; error lines are `role="alert"`; and every row button's
accessible name carries the note's first words (or who took it and when), so
a page of them is not one name said several times. This is where a memo recorded with no signal is confirmed, and the
retry for one whose transcription or extraction failed online.

Two pages mount `PendingMemoList`: the manager's
`[outreachId]/review` (behind `issueCaptureAccess()`), and the volunteer's
`app/volunteer/door-knocking/[turfId]/review`, which takes the turf's
`outreachId` from the turf read the walk already makes, checks only the
flag (`issueCaptureFlagGate`; the volunteer layout is the role gate), and
points its back arrow at the walk. gp-api narrows a volunteer to the notes
they recorded.

## Entry points

`WhatWeHeardLink` reads `N conversations · M notes` from the report and links
to it. It renders nothing while the flag is off (read without
exposure: the capture card is the treatment), when there is no envelope, or
until somebody has answered. It does not poll, so every write that moves its
counts re-reads it: `RecordKnockForm` and `PhoneBankingOutcomeForm` invalidate
`REPORT_QUERY_KEY_PREFIX` when a knock or call saves, when its memo lands and
when the memo is confirmed, and a queue drain that sent anything does the same.
A prefix rather than `reportQueryKey(outreachId)`, because neither form knows
the effort it belongs to, the same reason the review list has one.

- **Turf**: `TurfSummaryRow` fills `TurfSummaryCard`'s `heard` slot with it,
  keyed on `turf.outreachId`, and `TurfDetailsSheet` carries it under
  Progress, followed by `NotesToReviewLink` ("Notes to review: N", only
  while N > 0, same flag rule). See `door-knocking/AGENTS.md`.
- **Report**: the caption's "N waiting for review" clause.
- **Volunteer walk**: `VolunteerWalkPage` floats `NotesToReviewLink` over
  the top of the map, pointed at the volunteer's review page.
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
lists each memo's issues, with where the person stands and what they want,
and its accepted tags as badges under it.

## Analytics

`EVENTS.IssueCapture`, `product` on every event, and `channel` as
`doorKnocking` or `phoneBanking` (`analytics.ts`) to match the capture
events. Counts only, never a memo's words or a tag's name.

| Event                  | Fires                                | Properties                                                   |
| ---------------------- | ------------------------------------ | ------------------------------------------------------------ |
| `ReportViewed`         | Once per visit, on the first report  | `scope: 'effort'`, `channel`, `themeCount`, `confirmedCount` |
| `SynthesisRequested`   | On the button's press                | `scope: 'effort'`, `channel`, `confirmedCount`               |
| `TagAccepted`          | After an accept lands                | `source: 'report'` (the surface it was accepted on)          |
| `TagDismissed`         | After a dismiss lands                | none beyond `product`: the accept rate's denominator         |
| `PendingMemoConfirmed` | A confirm from the review list lands | `channel`, `ageHours` (since the memo was saved, to 0.1)     |

The offline path's other two, `MemoQueuedOffline` (`channel`) and
`MemoUploaded` (`channel`, `queuedForMs`), fire from
`app/dashboard/shared/dictation/useOfflineMemo.ts`.

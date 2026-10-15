# app/dashboard/issue-capture/

"What we heard": one effort's report. An effort is a door-knocking turf's or a
phone list's `Outreach` envelope, or a Serve text send, and the report shows
what people said on it, as ranked themes once there are enough confirmed
notes. On a text send the notes are the constituents' own replies: the
report's `channel` is `text`, every entry is a reply, nothing waits for
review, and the copy says reply where it would say note. Both products, on
one flag, `issue-capture`. The API is `packages/gp-api/src/constituentFeedback/`; shapes are
`@goodparty_org/contracts` `constituentFeedback/FeedbackSynthesis.schema.ts`.

## Files

| File                                                     | Role                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| `issueCaptureAccess.ts`                                  | The server gates (dashboard, and flag only); return `isServe`           |
| `[outreachId]/page.tsx`                                  | The report route                                                        |
| `[outreachId]/theme/[themeId]/page.tsx`                  | One theme                                                               |
| `[outreachId]/queries.ts`                                | Report (polls while a summary runs) and theme                           |
| `[outreachId]/components/WhatWeHeardPage.tsx`            | The report's client boundary and its four states                        |
| `[outreachId]/components/SummarizeButton.tsx`            | "Summarize notes" and its refusals                                      |
| `[outreachId]/components/ThemeGrid.tsx`, `ThemeCard.tsx` | Ranked cards                                                            |
| `[outreachId]/components/MemoList.tsx`                   | The notes, on the report and as a theme's members                       |
| `[outreachId]/components/DownloadNotesLink.tsx`          | Plain link to the CSV export, next to All notes / the pre-summary notes |
| `[outreachId]/components/PersonInfoSheet.tsx`            | A note's person, in Voter Data's record, in a side sheet                |
| `copy.ts`                                                | Every string, mode-keyed                                                |
| `analytics.ts`                                           | The `channel` value each effort reports under                           |
| `WhatWeHeardLink.tsx`                                    | The entry row on the turf                                               |
| `WhatWeHeardAction.tsx`                                  | The outreach drawer's link, at any status                               |

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
   said so far" over every note, and the Summarize button off with "Themes
   appear after {floor} confirmed notes." as its tooltip. `floor` comes from
   the report; never write the number. It beats a completed run
   because counts are read live and a memo can lose its confirmation.
3. **Completed**: `ThemeGrid`, then "All notes": the newest ten, the rest behind "Show N more notes". The download is every note either way.
4. **Failed**: "We couldn't summarize this time." over the previous run's
   themes, if there are any.

With no run and enough notes, it shows the button and every note. The button
shows whenever no run is in flight. It is off under the floor and after a
422 or 429, and says why in a tooltip on hover or focus, through the
styleguide's disabled-tooltip pattern (`Tooltip.stories`' `Disabled`: a
focusable span around a `pointer-events-none` button, since a disabled button
takes no pointer events). A failed start that is not a refusal is still a
line under the button.
Neither refusal outlives the report it was made against: a new run or a new
confirmed count resets the button, and a 429, which changes nothing on the
report and so does not re-read it, lifts on the report's next read. A 409
just refetches, since the report will show the run. `SynthesisRequested`
fires on the press, refused or not.

## Rules

- **Two counts head the report** (`ReportCounts`, under the title): people
  answered and left a note, in one `Card` laid out like Voter Data's
  `DistrictStatCard`: a row per count, the label left and the number right. Only
  confirmed notes enter a theme. **A text send keeps what it shipped with**
  and is not redesigned here: the caption "14 replies from 12 people.",
  "Every reply" listing every reply in its own divided list, and the floor
  line under the heading.
- **Cards rank by `conversationCount`**, the run's `rank` breaking ties: the
  issue several people raised rises. A count is "conversations that touched
  this theme", never a share, since one note can sit in two themes. The stance
  split is four counts, not a chart, for the same reason. It counts every
  issue raised in the theme's notes, so a note that raised two issues
  contributes two and the split can sum past the conversation count (interim,
  until membership is per issue; `packages/gp-api/src/constituentFeedback/AGENTS.md`).
  A reply names no issue, so a theme of replies has `stanceCounts: null`
  and the card and the theme page show no split at all.
- **Every note is labeled as the canvasser's summary** ("Summary by ..."),
  never quoted as the other person's words, with its issues listed under it
  (`MemoList`). A theme's members are confirmed only. A text reply is the
  person's own words and is labeled "Their reply", credited to nobody.
- **Copy is mode-keyed in `copy.ts`.** Win says voters and never constituent,
  Serve says constituents and never voter, and nothing says poll, survey,
  representative or statistically significant.
  `WhatWeHeardPage.test.tsx` and `ThemeDetailPage.test.tsx` assert all three
  across every state. The lines that say note take the report's `channel`
  and say reply on a text send; the door and the phone read as they did.
- **Download notes is for notes.** It is hidden on a text send: the export
  reads memos, and the replies are already the file the results page took
  in.
- **Download notes is a plain link, not a fetch.** `DownloadNotesLink`
  points straight at gp-api's `GET efforts/:outreachId/export` through the
  `/api/v1/...` proxy, with the `download` attribute, so the browser saves
  the CSV the same way `polls/[id]/components/DownloadResults.tsx` does for
  poll responses. It names no product noun ("Download"), so it needs
  no Serve variant. Hidden when the effort has no notes yet; shown next to
  "All notes" once there is a summary, and next to the pre-summary note
  list (`UnderFloorList`) before there is one. The CSV holds every note on
  the effort, not the report's 200-note display cap.
- **The report links back to the hub, not just the sidebar.** Polls' own back arrow is commented out, so the copy would have had none. Win's link carries `?outreachId=` so `/dashboard/outreach` reopens this effort's drawer; Serve's hub takes no such parameter and gets the plain path. The theme page links back to the report. **The report is laid out like Voter Data**: a title bar (`navHeader`) naming the outreach the report is about sits over everything, read through the hub's own `useOutreachDetail` (Serve's fetcher on Serve) and worded the way the hub's row and drawer word it, `name || title || 'Untitled campaign'`, empty until it loads; the way back is the CRM sheet's own Back (a ghost small `Button` with `ArrowLeftIcon` reading "Back", the hub named in its aria-label) in a full-bleed white top bar (Voter Data's own, negative margins and all), with Summarize at its right where Voter Data's Create new list sits, the report sits in its 560px column on the gray canvas, and only the note cards (`MemoList`, one styleguide `Card` per note) and the theme cards are white. The themes stack one per row, since a second card in a 560px column is a sliver. Only the top three show; any more wait behind "Show N more themes" (`ThemeGrid`), so the themes most people raised are not pushed down by the long tail. **The theme page is laid out the same way**: the theme's title is the title bar, the same top bar holds Back to the report, and every section in the 560px column is a white `Card` (`ThemeSummary`, the details, the asks) or the note cards, ten of them with the rest behind "Show N more notes" as on the report. `ThemeSummary` is the theme's own card on the report, rank circle, title, conversation count, summary and the stance tiles with no heading of their own, so the page says which theme it is; the number is the report's order (`rankThemes`, read off the cached report), with the run's `rank` standing in until that report arrives. **The top bar is the title bar's own size**, `h-14` like `DashboardNavHeader` and `px-6` from `md`, and what sits in it is `size="small"`, so the two bars read as one height; a medium Summarize made the second bar 64px. On a phone the column adds `px-2` to the layout's `p-2`, 16px from the edge, and the top bar is `px-4` there (Voter Data's own bar), so the two line up; 8px read cramped and 24px wider than the rest of the app.
- **What people want is ranked by mentions, and shows no count.** The theme
  page counts how many issues in the theme's notes named each ask (the API
  sends the asks deduplicated, so `ThemeDetails` counts them from `members`),
  merges spellings that differ only in case, and shows the raw asks as
  outline badges in a row, the most named first. Five show; the rest wait behind "Show N
  more". No number is printed: an exact-match count splits one ask written
  two ways, so it would read as a measure it is not. Summarized asks with real
  counts are a backend task (synthesis).
- **A note opens its person in place.** Each door or call note carries
  "Voter data" ("Constituent data" on Serve), a small link at the end of its meta line, sentence case because it opens a sheet rather than the tab, which opens a side sheet with
  that person's record as Voter Data renders it: `PersonInfoSheet` mounts
  `PersonRecord` (the presentational half of `PersonOverlay`) in
  `PersonOverlay`'s own sheet shell, on the contacts page's person query key,
  the way the chat's `ConstituentsCard` does. The parts that read Voter
  Data's own table (the Win status row, top issues, the activity feed) and
  the map are left out. A text reply has no button: that branch stays as it
  shipped.
- **Copied from `polls/`, not imported.** The cards and the theme page are
  adapted from `polls/[id]/components/PollsIssue*` and
  `polls/[id]/issue/[issueIndex]/components/*`. Polls' providers are
  poll-typed and server-fed; here the data is React Query, so components take
  props.
- **The report only reads notes.** A note is changed where it was taken, in
  the confirm step at the door or on the call; the report has no edit or
  delete on a note.
- **Users see themes, never tags.** A run still proposes a tag per theme
  and links it to the theme's notes, and later runs reuse it by name
  (`packages/gp-api/src/constituentFeedback/AGENTS.md`), but nothing on the
  report names a tag or asks anyone to accept or dismiss one. The person
  record shows accepted tags only, so a proposed one stays off it.

## Confirming notes

A note is confirmed at the door or on the call, in the confirm step: "Looks
right" saves the issues as shown, and Skip (or closing the step) saves the
note confirmed with no issues, so its words still go into the summary.
A note sent later from a phone with no signal has nobody at the door to
confirm it, so it stays unconfirmed and out of the themes.

## Entry points

`WhatWeHeardLink` reads `N conversations · M notes` from the report and links
to it. It renders nothing while the flag is off (read without
exposure: the capture card is the treatment), when there is no envelope, or
until somebody has answered. It does not poll, so every write that moves its
counts re-reads it: `RecordKnockForm` and `PhoneBankingOutcomeForm` invalidate
`REPORT_QUERY_KEY_PREFIX` when a knock or call saves, when its memo lands and
when the memo is confirmed, and a queue drain that sent anything does the same.
A prefix rather than `reportQueryKey(outreachId)`, because neither form knows
the effort it belongs to.

- **Turf**: `TurfSummaryRow` fills `TurfSummaryCard`'s `heard` slot with it,
  keyed on `turf.outreachId`, and `TurfDetailsSheet` carries it under
  Progress. See `door-knocking/AGENTS.md`.
- **Outreach drawer**: `WhatWeHeardAction` is the drawer's own way in, at
  any status, which is what reaches a finished list (its drawer has no
  Continue calling). It is a button in the sticky footer beside the
  campaign's action (Continue calling, Mark campaign done or the archive
  shelf), side by side on a desktop and stacked on a phone. It reads only the flag, not the report, so opening a
  drawer costs no request. A phone row links its own id. A door-knocking
  row links only when the campaign is one turf, to that turf's envelope: a
  report is per turf and the row's id names just the anchor's, so a
  several-turf campaign leaves it to the turf cards.
- **Serve text send**: the drawer's Serve SMS section (above
  `ServeSmsRepliesSection`, completed sends only) carries `WhatWeHeardLink`,
  the counted one, reading "N replies": a send nobody has replied to has
  nothing to report, and the link says nothing until somebody has. A Win
  text gets no link; its replies come back as timestamps, never words.

The person record (`contacts/crm/person/ConstituentFeedbackSection.tsx`)
lists each memo's issues, with where the person stands and what they want,
and its accepted tags as badges under it.

## Analytics

`EVENTS.IssueCapture`, `product` on every event, and `channel` as
`doorKnocking`, `phoneBanking` or, on a text send, `sms` (`analytics.ts`) to
match the capture and outreach events. Counts only, never a memo's words or
a tag's name.

| Event                | Fires                               | Properties                                                   |
| -------------------- | ----------------------------------- | ------------------------------------------------------------ |
| `ReportViewed`       | Once per visit, on the first report | `scope: 'effort'`, `channel`, `themeCount`, `confirmedCount` |
| `SynthesisRequested` | On the button's press               | `scope: 'effort'`, `channel`, `confirmedCount`               |

The offline path's other two, `MemoQueuedOffline` (`channel`) and
`MemoUploaded` (`channel`, `queuedForMs`), fire from
`app/dashboard/shared/dictation/useOfflineMemo.ts`.

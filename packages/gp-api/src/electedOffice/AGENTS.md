# electedOffice

An elected official's seat in Serve. Each `ElectedOffice` owns an
`eo-<id>` organization (`organizationSlug`); deleting that org cascades the
office and everything either of them owns.

| File                                  | What                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `services/electedOffice.service.ts`   | `create` (idempotent per user and per campaign, non-overlapping terms) and `update`            |
| `services/winOffice.service.ts`       | Dormant offices for wins, offices prepared ahead of a result, the daily sweep                 |
| `util/winOffice.util.ts`              | `campaignWinState`: what a campaign's result says and which source said it; `canPrepareOffice` |
| `util/electedOffice.util.ts`          | `isPreparedOffice`: the one predicate for "prepared, so invisible"                             |
| `services/winTerm.service.ts`         | A winner's term from their BallotReady office-holder record                                   |
| `services/crmOfficeHolder.service.ts` | HubSpot Office Holder sync on every office write                                              |
| `electedOffice.controller.ts`         | `/v1/elected-office`; `PUT /:id` with `onboardingCompletedAt` is the pledge                   |

## Dormant until the pledge

An office with `onboardingCompletedAt` null is dormant: no scheduled Serve
jobs, no dashboard redirect except the Pro winner's, and it never leads the
org list (`sortOrganizations`). `create` fires the paid create-time
dispatches (meeting schedule, community issues, ordinance sourcing) only for
an office created onboarded; `update` fires them when a write stamps
`onboardingCompletedAt` on an office that had none. All three skip an org
that already has a run, so a retry is safe. Leads, net-new onboarding and
win offices all get their first runs at the pledge.

## Every win gets one office

`WinOfficeService` gives every won campaign one office linked by
`campaignId`, shaped like the Pro handoff: the campaign org's position, the
party mapped to Serve's values, `onboardingStep: 'confirm'`, and the
BallotReady term when there is one. `campaignWinState` decides, in this
order: `didWin`, then `details.wonGeneral`, then
`data.hubSpotUpdates.election_results`. HubSpot's value names no race, so
with an election date still ahead (a candidate running again, whose own
result was cleared) it is ignored and the campaign has no win.

| Source    | Where                                                                          | `winSource`     |
| --------- | ------------------------------------------------------------------------------ | --------------- |
| Candidate | `PUT /v1/campaigns/mine` (`wonGeneral`), Pro handoff `POST /v1/elected-office` | `self_reported` |
| Staff     | `PUT /v1/admin/campaigns/:id` (`didWin`), M2M `PUT /v1/campaigns/:id`          | `staff`         |
| DDHQ      | Written to Postgres by `gp-data-platform`; found by the daily sweep            | `ddhq`          |

The in-app paths call `reconcile` right after the write; the daily sweep
(the `winOfficeSweep` pg-boss schedule, 11:19 UTC) catches everything else
and is the backfill. It sends one `winOfficeSync` job per campaign in any of
three states: a win with no office, an ever-Pro campaign with no result in
the prepare window (below), and a dormant win office whose campaign now
reads lost or is running again. Nothing is capped per run — the
`winOfficeSync` queue's `maxConcurrent` (3, for HubSpot's rate limit) is what
paces the creates and their Office Holder syncs. Test-mode orgs and demo
campaigns are skipped, and so are ever-Pro wins (`campaignWasEverPro` in
`@goodparty_org/contracts`, mirrored in the sweep's SQL) whose election is
over a year old: an ever-Pro winner's unfinished office redirects them to
Serve onboarding on every dashboard visit, and the backfill must not start
that for long-past winners.
`win_source` is set on a fresh create, so a lead's office that a win links
keeps it null and is never deleted for a loss; a `pending` office is the one
exception, becoming the winning source when the result lands.

## Prepared ahead of a result

Most users never get a DDHQ result in time, and an office created at "I won"
is too late to have found the meeting schedule. So `WinOfficeService.prepare`
builds one early: an ever-Pro campaign whose election date has passed no more
than 30 days ago (`PREPARE_WINDOW_DAYS`) and has no result on record yet gets
an office shaped exactly like a win office, with `winSource: pending`. Its
meeting schedule and ordinance sourcing run now
(`ElectedOfficeService.dispatchForPrepared`), so that research is waiting when
the result lands. Community issues do **not**: their run completion emits
Segment events that send the holder a HubSpot "your issues are ready" email,
and a candidate with no result yet may have lost. Serve onboarding runs its own
quick community-issue starter, and the pledge dispatches all three as usual.
Everything after that stays gated on the pledge: the schedule completion
handler chains no briefing for an office without `onboardingCompletedAt`, and
no scheduled Serve job selects one.

An office is prepared only when it is invisible: `isPreparedOffice`
(`winSource: pending` and `onboardingCompletedAt` null — the pledge ends it)
keeps it out of the org list, off `DashboardLayout`'s Serve onboarding
redirect, and out of the HubSpot Office Holder sync. `GET
/v1/elected-office/mine` reports it as `prepared` for exactly that. The sweep
does not prepare for a user who already holds a term-less lead office:
`create` would adopt and campaign-link that one, which the dashboard would
then redirect.

A result resolves the prepared office, from any source. A win replaces
`pending` with the real source (`ensureForWin` on the existing office, for
`reconcile` and the sweep alike) and syncs the Office Holder record. A loss
deletes it through the withdrawn-win path below. No result leaves it as it
is, and it leaves the sweep's view once it ages past the window.

## A withdrawn win

A loss from any source, or `resetStaleElectionResults` when the candidate
runs again, deletes the office only if `winSource` is set and
`onboardingCompletedAt` is null, by deleting its `eo-<id>` org in one
transaction that locks the campaign row and then the office row. The HubSpot
Office Holder record is left in place.

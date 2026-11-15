# electedOffice

An elected official's seat in Serve. Each `ElectedOffice` owns an
`eo-<id>` organization (`organizationSlug`); deleting that org cascades the
office and everything either of them owns.

| File                                  | What                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| `services/electedOffice.service.ts`   | `create` (idempotent per user and per campaign, non-overlapping terms) and `update` |
| `services/winOffice.service.ts`       | Dormant offices for wins: create, remove on a withdrawn win, daily sweep            |
| `util/winOffice.util.ts`              | `campaignWinState`: what a campaign's result says, and which source said it         |
| `services/winTerm.service.ts`         | A winner's term from their BallotReady office-holder record                         |
| `services/crmOfficeHolder.service.ts` | HubSpot Office Holder sync on every office write                                    |
| `electedOffice.controller.ts`         | `/v1/elected-office`; `PUT /:id` with `onboardingCompletedAt` is the pledge         |

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
(the `winOfficeSweep` pg-boss schedule, 11:19 UTC, finds up to 200 creates
and 200 removals a run, newest campaigns first, and sends one
`winOfficeSync` job per campaign) catches everything else and is the
backfill. Test-mode orgs and demo
campaigns are skipped, and so are ever-Pro wins (`campaignWasEverPro` in
`@goodparty_org/contracts`, mirrored in the sweep's SQL) whose election is
over a year old: an ever-Pro winner's unfinished office redirects them to
Serve onboarding on every dashboard visit, and the backfill must not start
that for long-past winners.
`win_source` is set only on a fresh create, so a lead's office that a win
links keeps it null and is never deleted for a loss.

A withdrawn win (a loss from any source, or `resetStaleElectionResults` when
the candidate runs again) deletes the office only if `winSource` is set and
`onboardingCompletedAt` is null, by deleting its `eo-<id>` org in one
transaction that locks the campaign row and then the office row. The HubSpot
Office Holder record is left in place.

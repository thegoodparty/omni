# Win Contacts staged rollout and rollback

This is the flag-driven rollout plan for the Win Contacts feature (the Serve
Contacts surface extended to pro Win campaigns: browse the voter file, filter by
party, save and use segments, download channel files, and see an outreach
activity timeline on a person).

The whole feature flips on one flag: `win-voter-data` (Amplitude Experiment).
Nothing here flips the flag for you. Enabling it for real cohorts is a manual ops
action performed in Amplitude. This document defines the steps and the rollback.

## What the flag gates

`win-voter-data` is the master gate for the rollout. It is read in two places:

- Frontend: `useWinVoterDataFlag` (`app/shared/experiments/winVoterDataFlag.ts`).
  It drives the Contacts nav entry for pro Win campaigns
  (`DashboardMenu.tsx`, `WIN_CONTACTS_MENU_ITEM`) and the Win surfaces on the
  page (party filter, outreach timeline).
- Backend: gp-api `ContactsService.assertContactsAccess` hard-gates every
  `/v1/contacts` route for campaign orgs on `win-voter-data` being on for the
  user AND `campaign.isPro`. Elected-office (Serve) orgs predate the rollout and
  are never gated by this flag.

Access is enforced server-side, so the flag is a real access control for campaign
orgs, not just a UX toggle. Elected-office Contacts is unaffected by this flag at
every stage below.

## Preconditions before stage 1

- The flag `win-voter-data` exists in Amplitude Experiment with a stable key and
  defaults to `off` (the frontend hook falls back to `off`, and the backend
  treats a missing variant as off).
- A targeting segment exists for internal and test users. Use email-domain
  targeting on `@goodparty.org` (staff) and `@test.goodparty.org` (e2e test
  users created by the suite).

## Stage 1: internal and test campaigns

Goal: dogfood the full Win flow and turn the e2e gate green on the warm dev
stack.

1. In Amplitude, set `win-voter-data` to `on` for the internal/test segment
   (`@goodparty.org` and `@test.goodparty.org`) in the dev project first, then
   the production project once dev looks good.
2. Confirm the e2e coverage runs. The `Win Contacts @dev-only` spec
   (`win-contacts.spec.ts`) exercises list, party filter, segment save/use,
   download, and the person outreach timeline. It is `@dev-only`, so it runs on
   the post-merge develop e2e (where the dev flag state and pro provisioning
   exist), not on per-PR previews.
3. Watch dashboards for errors on `/v1/contacts*` (Grafana Loki,
   `{service_name="gp-api"}`) and frontend errors (Sentry, org `goodparty`).

Exit criteria: e2e green on develop, no new `/v1/contacts*` error rate, internal
users report the flow works end to end.

## Stage 2: small cohort

Goal: validate with a bounded set of real pro Win campaigns before GA.

1. In Amplitude, add a small percentage rollout (for example 5 to 10 percent of
   pro Win campaign users) on top of the internal/test segment, in production.
2. The flag is keyed on `user_id`, so a user's bucket is stable across sessions.
   Keep the internal/test segment at 100 percent so staff and e2e stay covered
   regardless of the percentage bucket.
3. Monitor for a few days: `/v1/contacts*` error rate and latency,
   `VOTER_DATA_UNAVAILABLE` 400s (ineligible districts), download success, and
   Sentry frontend errors. Compare exposed vs unexposed via the `$exposure`
   event that the page fires.

Exit criteria: error and latency steady against the unexposed population, no
spike in `VOTER_DATA_UNAVAILABLE`, downloads succeeding.

## Stage 3: general availability

1. In Amplitude, raise the production rollout to 100 percent of pro Win campaign
   users.
2. Keep monitoring for the first 24 to 48 hours.
3. Once stable, plan flag removal as a follow-up: delete the `win-voter-data`
   gate from the frontend hook and the gp-api access check, then grep for
   stragglers. Removal is out of scope for this rollout; do it only after GA has
   held.

## Rollback

Rollback is the flag off. There are no data migrations to reverse.

- Fastest path: in Amplitude, set `win-voter-data` to `off` for the affected
  cohort (or all of production). Because the backend reads the flag per request,
  campaign orgs immediately get a `403` from `/v1/contacts*` and the frontend
  hides the Win surfaces. Elected-office Contacts is unaffected.
- Partial rollback: if only the small-cohort percentage is the problem, set the
  percentage rollout back to 0 and leave the internal/test segment on, so staff
  and e2e stay covered while real users are reverted.
- No code deploy is required to roll back. A code revert is only needed if a bug
  is in the gated code itself rather than in enabling it; in that case revert the
  offending PR as usual.

## e2e coverage scope

The `Win Contacts @dev-only` spec covers what is deterministic against the live
dev stack: the list loads, the party filter section is present and selectable,
a custom segment saves and becomes the active reusable segment, the download
request to gp-api succeeds (pro-gated), and the person overlay shows the Win
Political Party field and the outreach Activity Feed section.

It deliberately does not assert a specific attributed outreach activity row.
`VoterOutreachActivity` rows are produced by outreach sync (eCanvasser
door-knocks and similar) and are not seedable from e2e, so a freshly created test
campaign has zero rows and the feed renders its "Data not available." empty
state. Asserting a concrete row would be non-deterministic and would make the
hard e2e merge gate flaky. The spec asserts the Activity Feed section renders
(which proves the Win timeline is wired and keyed on `person.lalVoterId`) and
leaves attributed-row content to the gp-api unit tests for
`contactEngagement`/`voterOutreachActivity`.

# Segment → HubSpot Integration

This document describes how Segment events flow from the API to HubSpot and trigger workflows that update contact/company fields.

## Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   gp-api    │────▶│   Segment   │────▶│   HubSpot   │────▶│  Workflows  │
│             │     │             │     │   Events    │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
     Track()         Firehose V2        Custom Event       Update Status
                     Mapping            pe21589597_        on Contact &
                                        segment___         Company
                                        all_track
```

## Single-Send Cutover: Email Inventory (ENG-11033)

**Status: eng draft.** Not yet signed off. Before tasks 6–7 (asset creation,
cutover) build on this list it still needs: (1) an Ops portal spot-check
confirming no send-bearing HubSpot workflow is missing below, and (2) Ops +
data team sign-off on the move list itself.

### Why

The team-merge precondition: two live product accounts (Serve/Win) can only be
merged once transactional-style app email is off HubSpot workflows. A workflow
resolves its send to the merged **Contact's** primary email and personalizes
from the Contact record — after a merge that can be the wrong address, or the
wrong campaign's content at the right address. The [HubSpot Single-Send
Transactional Email
API](https://developers.hubspot.com/docs/api/marketing/transactional-emails)
sends to an address gp-api supplies directly and isn't subject to the Contact
record at all, so it survives a merge. This inventory lists every gp-api
Segment event that exists to trigger a HubSpot email, matches it to what fires
it and what HubSpot asset it feeds, and classifies each **move** (cut over to
single-send) or **stay** (lifecycle, stays on a workflow).

Two framing facts from the TDD, load-bearing for how "move" is scoped:

- None of the portal's ~999 email assets are HubSpot's native Transactional
  type today. "Transactional" in an asset's name (e.g. "Serve - Transactional
  Email - Results Ready") is naming convention only — every one is an
  `AUTOMATED_EMAIL` marketing send, gated by marketing-contact status,
  opt-out, and bounce suppression like any other workflow email.
- ~21% of product-account emails today can't receive a marketing send
  (non-marketing contact, hard bounce, opt-out). The Single-Send API is not
  subject to that gate — it's a transactional send. So every row below marked
  **MOVE** is a deliverability fix for that ~21%, not just a merge fix; that's
  worth weighting into task-7 prioritization independent of the merge work.

**Recipient rule for every MOVE below:** send to the gp-api account email of
the `userId` that fired the event, fetched fresh from `User` at send time —
never an address resolved from the (potentially merged) HubSpot Contact. The
per-row "Recipient" cell names which account that is (it's almost always
"whoever's `userId` the firing code passes to `analytics.track`," but two
flows resolve a different account and are called out).

### 10DLC / TCR compliance — MOVE

One-time, single-recipient notices tied to a specific compliance-flow
transition. Each already has a named Segment event and a specific trigger;
none of them personalize from ongoing per-campaign content, so none of them
have the merge-clobber problem the lifecycle section below has — they just
send to the wrong address post-merge, which is exactly what single-send fixes.

| Event                                                | Fired from                                                                                 | HubSpot asset today                                                 | Single-send asset to create                          | Recipient                    |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------- |
| `Voter Outreach - 10DLC Compliance PIN Sent`         | `campaignTcrCompliance.service.ts:594` (`CampaignTcrComplianceService`, PIN-delivery sweep) | "check your texts/email" nudge — **Ops to confirm** asset name       | "Win - Transactional Email - PIN Delivered"           | `userId` passed to the sweep  |
| `Voter Outreach - 10DLC Compliance PIN Resent`       | `campaignTcrCompliance.service.ts:2294` (`trackCompliancePinResent`, admin-triggered resend)  | Same nudge, resend variant — **Ops to confirm**                       | "Win - Transactional Email - PIN Resent"              | `campaign.userId`             |
| `Voter Outreach - 10DLC Compliance Form Submitted`   | `campaignTcrCompliance.controller.ts:226` (agentic flow) and `:289` (manual flow)             | "Registration Submitted #1 - 10 DLC" (TDD-confirmed name)              | "Win - Transactional Email - Registration Submitted"  | `user.id`                     |
| `Voter Outreach - 10DLC Compliance PIN Submitted`    | `campaignTcrCompliance.controller.ts:364`                                                     | "PIN Submitted - 10 DLC" (TDD-confirmed name)                          | "Win - Transactional Email - PIN Submitted"           | `user.id`                     |
| `Voter Outreach - 10DLC Compliance Completed`        | `queueConsumer.service.ts:528` (`handleTcrComplianceCheckMessage`)                            | Likely "Texting compliance confirmation" (TDD asset list) — **Ops to confirm the exact match**; no separate event exists for that asset name, and this is the only event marking texting as unlocked, so it's the best-fit candidate | "Win - Transactional Email - Texting Compliance Confirmed" | `userId`                |
| `Voter Outreach - 10DLC Compliance Rejected`         | `campaignTcrCompliance.service.ts:480` (`cv_status_check` source) and `:1514` (`cv_submit` source) | Fix-your-filing CS outreach trigger — **Ops to confirm** asset name   | "Win - Transactional Email - Compliance Rejected"     | `user.id`                     |

The "Texting compliance confirmation" line item from the ticket's seed list
and `ComplianceCompleted` are the same email: no other event in
`segment.types.ts` marks a campaign's TCR registration as approved, and the
existing 10DLC flow doc above calls this transition "Compliant."

### Poll results — MOVE

| Event                             | Fired from                     | HubSpot asset (TDD-named)                          | Single-send asset to create                        | Recipient          |
| ---------------------------------- | --------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- | -------------------- |
| `Poll - Results Synthesis Complete` | `queueConsumer.service.ts:845`  | "Serve - Transactional Email - Results Ready"          | Reuse the existing asset as-is via single-send            | `office.userId`      |

Reason: one-time notice that a specific poll's results are ready, addressed by
a link (`path`) into that poll — no ongoing personalization, no merge-clobber
exposure.

### Meeting briefing ready — MOVE

| Event                              | Fired from                              | HubSpot asset       | Single-send asset to create                       | Recipient |
| ------------------------------------ | ------------------------------------------ | ---------------------- | ------------------------------------------------------- | ----------- |
| `Briefing Assistant - Agenda Created` | `meetingBriefings.service.ts:1332` (string literal, `trackAgendaPickedUp`) | **Ops to confirm** | "Serve - Transactional Email - Briefing Ready"         | `userId`  |

Reason: same shape as poll results — one meeting's agenda is ready, addressed
by that meeting's id.

**Caveat, flagged for the Ops portal spot-check:** unlike poll results, this
event's payload carries real per-meeting content (`execSummary`, the
flattened top agenda items, `meetingPlace`) — the same shape as the
lifecycle events in the personalization-gap section below, not a bare
pointer/link. It's classified MOVE here on the assumption that today's
HubSpot workflow personalizes its email directly from this enrollment
event's properties rather than writing them onto the contact record for
later reuse (the way `Campaign Plan - Weekly Tasks Digest` documented below
does). If the portal spot-check finds this event actually populates a
persistent contact field, move this row into the personalization-gap
section instead — it would have the same merge-clobber exposure.

### Robocall payment / receipt — MOVE (ENG-11035, shipped)

Named explicitly in the TDD as move-eligible. Every milestone below carries a
deterministic Segment `messageId` (`<outreachId>:<milestone>[:<suffix>]`) so a
replay dedups to one email regardless of transport — that property is
unaffected by the single-send cutover.

A robocall-services refactor (`outreachRobocallCompletion.service.ts`
consolidation, `callhubCredits` removal) landed between the inventory draft
and this cutover and shifted every line number below; re-verified against
`git blame` at cutover time. All six firing methods route through one of two
shared `emitMilestone` chokepoints (`outreachRobocallHold.service.ts` for
HoldPlaced/HoldFailed/SendFailed, `outreachRobocallHoldFailure.service.ts`
for Reminder/Canceled), so the single-send call was added there once per
file rather than at every individual site.

| Event                     | Fired from                                                                                                     | Single-send env var                       | Recipient         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | ------------------- |
| `Robocall - Scheduled`    | `outreachRobocall.service.ts` (`emitScheduled`, called from `createDraft`)                                        | `HUBSPOT_ROBOCALL_SCHEDULED_EMAIL_ID`      | `campaign.userId` |
| `Robocall - Hold Placed` | `outreachRobocallHold.service.ts` (`emitMilestone`, called from `authorizeHold`'s success commit)                 | `HUBSPOT_ROBOCALL_HOLD_PLACED_EMAIL_ID`    | `user.id`         |
| `Robocall - Hold Failed` | `outreachRobocallHold.service.ts` (`emitMilestone`, via `transitionToHoldFailed` — decline + card-escalation) and `outreachRobocallSend.service.ts` (`emitHoldFailed`, dead hold at dial time) | `HUBSPOT_ROBOCALL_HOLD_FAILED_EMAIL_ID`    | `userId`          |
| `Robocall - Send Failed` | `outreachRobocallHold.service.ts` (`emitMilestone`, called from `failSend`)                                       | `HUBSPOT_ROBOCALL_SEND_FAILED_EMAIL_ID`    | `userId`          |
| `Robocall - Reminder`    | `outreachRobocallHoldFailure.service.ts` (`emitMilestone`, called from `remindHoldFailure`)                       | `HUBSPOT_ROBOCALL_REMINDER_EMAIL_ID`       | `campaign.userId` |
| `Robocall - Canceled`    | `outreachRobocallDeferredHold.service.ts` (`emitCanceled`, called from `cancelExpiredDeferred`) and `outreachRobocallHoldFailure.service.ts` (`emitMilestone`, called from `cancelExpiredHoldFailure`) | `HUBSPOT_ROBOCALL_CANCELED_EMAIL_ID`       | `campaign.userId` |
| `Robocall - Receipt`     | `outreachRobocallFreshCharge.service.ts` and `outreachRobocallCapture.service.ts` (both `emitReceipt`)            | `HUBSPOT_ROBOCALL_RECEIPT_EMAIL_ID`        | `userId`          |

All seven asset ids are **Ops to create and set** — every env var above is
unset in every environment today, so each milestone still sends only via the
existing Segment-event -> HubSpot workflow path until Ops creates the asset
and sets the id. `OutreachRobocallSingleSendService`
(`src/outreach/services/outreachRobocallSingleSend.service.ts`) is the shared
single-send leg for all seven: it resolves the recipient's email fresh from
`userId` (most firing sites carry only a userId, not a loaded `User` — several
are SQS-consumer or payment-flow terminals), skips silently when its env var
is unset, and never throws — a HubSpot failure must never fail a payment
capture, an SQS consumer, or a cron sweep transition.

### Lifecycle digests and nudges — STAY

| Event                                        | Fired from                                                        | Reason to stay                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `Campaign Plan - Weekly Tasks Digest`          | `weeklyTasksDigestHandler.service.ts:214` (weekly cron via SQS)        | Recurring, personalizes from `win_campaign_plan` contact fields the cron overwrites every week — see the gap below.        |
| `Person Profile - Completion Requested`        | `crm-person-profiles.service.ts:266` (`emitCompletionRequested`)       | Not account-scoped to the firer at all — resolves the **subject's** email, a different contact than any campaign account. |
| `Community Issues - Initial Issues Generated`  | `communityIssue.service.ts:224`                                        | Personalizes from per-campaign issue content on the contact record — see the gap below.                                    |
| `Community Issues - Top Issues Refreshed`      | `communityIssue.service.ts:245`                                        | Same as above; refreshed content overwrites the prior snapshot on the same contact fields.                                 |
| `Community Issues - Trending Issues Refreshed` | `communityIssue.service.ts:253`                                        | Same as above.                                                                                                              |

### Re-engagement nudges — STAY (found via sweep, not in the seed list)

Both carry an explicit "feeds a HubSpot re-engagement email" comment in
`segment.types.ts` — the seed list didn't include them.

| Event                                            | Fired from                                                     | Reason to stay                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `Briefing Assistant - Dispatch Skipped`            | `meetingBriefings.service.ts:1031`                                   | Recurring inactivity-gated nudge, not a one-time transactional confirmation.             |
| `Community Issues - Top Issues Dispatch Skipped`   | `communityIssueDispatch.service.ts:354` (`trackDispatchSkippedInactive`) | Same shape — cron-driven re-engagement, fires repeatedly for an inactive account.        |
| `Community Issues - Trending Issues Dispatch Skipped` | `communityIssueDispatch.service.ts:354`                           | Same as above (same call site, event chosen by `experimentType`).                        |

### Excluded — no gp-api-fired event

| Event                                | Where it exists                        | Status                                                                                                                                    |
| --------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `Account - Password Reset Requested`   | `segment.types.ts` only (`Account.PasswordResetRequested`) | Defined but **never fired** anywhere in `src/`. Password reset goes out via Mailgun (`email.service.ts`), not HubSpot. Exclude unless Ops finds a portal workflow keyed on it. |

### Swept, not yet classified — Ops to confirm before scoping

These exist in `segment.types.ts` and are plausible email triggers, but
nothing in this repo (a comment, a doc, a named TDD asset) confirms a HubSpot
email is keyed off them, so they aren't classified above. Worth a portal
check, not a code-side one:

- `Onboarding - Magic Link Sent` (`Onboarding.MagicLinkSent`, fired from
  `adminElectedOffice.controller.ts:101` and
  `adminCampaignMagicLink.controller.ts:73`) — its own in-code comment calls it
  a **"link sent" funnel event**, and it deliberately does not carry the
  magic-link URL/token in its properties (consistent with never putting
  credentials in a Segment payload). If a HubSpot workflow does email the
  actual link off this event, it must be sourcing the URL from a contact
  property set elsewhere — confirm that exists before assuming this is
  move-eligible.
- `Candidate Website - Published` / `Candidate Website - Purchased domain` —
  already mapped in the 10DLC Compliance Flow table above, but as **status
  writes** (`Ops - Set 10 DLC Compliance Status to ...`), not a confirmed
  standalone email. Leave as-is; don't add to the move list without an Ops-
  confirmed asset.
- `Peerly Identity ID Created` — already documented above as a **company
  property** write (`peerly_identity_id`), not an email trigger.

Everything else in `segment.types.ts` (`Account.ProSubscriptionConfirmed`,
`Account.ProUpgradeComplete`, `Account.UserDeleted`, `Onboarding.UserCreated`,
`Outreach.FreeTextsOfferRedeemed`, `Outreach.CampaignVerifyTokenStatusUpdate`,
`Outreach.ComplianceCandidateProfileSubmitted`, the `AiContent`, `AiChat`,
`CampaignPlanV2`, `RaceOpponent`, `Ordinances`, `Campaigns`, and `Team` event
groups) has no comment, doc reference, or TDD asset name tying it to a
HubSpot email — treated as product-analytics-only for this inventory. If a
portal spot-check finds a send-bearing workflow keyed on any of them, add it
above rather than assuming this list is exhaustive.

### The dual-account personalization gap (for the data team)

`Campaign Plan - Weekly Tasks Digest` and all three `Community Issues -
*Refreshed`/`*Generated` events write **per-campaign content onto contact
properties** — `task_name_1`-`5`, the community-issue headline/summary
fields — and the HubSpot email personalizes straight from those properties
on the Contact record. `Briefing Assistant - Agenda Created` carries the
same kind of per-meeting content (see the caveat above) but is classified
MOVE pending Ops confirming its workflow doesn't persist that content to the
contact the way the digest does; if it does, treat it as part of this gap
too.

That's fine for one account per email address. It breaks once two live
product accounts sharing an address get merged: both accounts' weekly-digest
or issue-refresh jobs keep writing to the *same* contact's fields, so
whichever job ran most recently wins, and the merged contact can receive an
email addressed correctly but built entirely from the other campaign's
content — a candidate getting their opponent's task list, or an elected
official getting the wrong district's community issues. Single-send doesn't
fix this on its own: sending to the right address with content read from a
clobbered property is still wrong content. These are classified **stay
(lifecycle)** above specifically because the single-send cutover doesn't
address this gap — it's a separate decision the data team owns.

Options, in the order the TDD raises them:

1. **Move these to single-send too.** Fixes the clobber, since single-send
   content is composed and sent per-event rather than read back from a
   property at send time. Costs the most: unlike the transactional set above,
   these are recurring/lifecycle in nature, so it's a bigger asset-authoring
   and template-personalization lift for Ops, not a one-time notice.
2. **Hold merges for dual-account contacts.** Detect at merge time that both
   accounts have an active weekly-digest, community-issues, or briefing
   subscription and block (or require manual review of) the merge until one
   side is resolved. Cheapest change, but adds an ongoing manual-review queue
   and doesn't shrink over time as more accounts overlap.
3. **Accept the risk.** Let merges proceed and accept that a dual-account
   contact's lifecycle content can render wrong until its next natural
   refresh cycle overwrites it. Lowest engineering cost; the failure mode is
   silent (wrong content, not a bounce or error) so it would need its own
   monitoring if chosen.

## 10DLC Compliance Flow

The compliance flow tracks user progress through these stages:

1. **Website Created** - User publishes their campaign website
2. **Domain Purchased** - User purchases a custom domain
3. **Registration Submitted** - User submits 10DLC compliance form
4. **Compliance Pending** - User submits PIN verification
5. **Compliant** - Backend confirms registration is approved

## Event → HubSpot Workflow Mappings

| Event Name                                         | HubSpot Workflow                                                 | Sets Status To         | Fired From                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------- |
| `Candidate Website - Published`                    | Ops - Set 10 DLC Compliance Status to Website Published          | Website Created        | `WebsitesController.updateWebsite()`                        |
| `Candidate Website - Purchased domain`             | Ops - Set 10 DLC Compliance Status to Purchase domain            | Domain Purchased       | `DomainsService.processDomainRegistration()`                |
| `Voter Outreach - 10DLC Compliance Form Submitted` | Ops - Set 10 DLC Compliance Status to Compliance form Submitted  | Registration Submitted | `CampaignTcrComplianceController.createTcrCompliance()`     |
| `Voter Outreach - 10DLC Compliance PIN Submitted`  | Ops - Set 10 DLC Compliance Status to Compliance PIN Submitted   | Compliance Pending     | `CampaignTcrComplianceController.submitCampaignVerifyPIN()` |
| `Voter Outreach - 10DLC Compliance Completed`      | Ops - Set 10 DLC Compliance Status to 10 DLC Compliance Complete | Compliant              | `QueueConsumerService.handleTcrComplianceCheckMessage()`    |

## Peerly Identity ID → Company

When a candidate's Peerly identity is created during 10DLC/TCR submission, gp-api fires `Peerly Identity ID Created` carrying the Peerly identity id. The goal is to store it on the HubSpot **company** record as `peerly_identity_id`, so Campaign Success can match Peerly's 10DLC Slack notifications (which reference only this id) to the right company record in Zapier.

| Event Name                   | HubSpot Target                      | Properties                                                                    | Fired From                                      |
| ---------------------------- | ----------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| `Peerly Identity ID Created` | `peerly_identity_id` on the company | `peerly_identity_id`, `company_hubspot_id` (omitted until the company exists) | `CampaignTcrComplianceService.submitToPeerly()` |

Notes:

- Fires once, only when the identity is **first created** — not on idempotent retries or existing-identity reuse.
- Unlike the compliance-status events above (which land on the contact by email and rely on a workflow to copy to the company), this event also sends `company_hubspot_id` (`campaign.data.hubspotId`) so the mapping can target the company directly. The contact id still rides along in `context.traits.hubspotId`.
- Property keys are snake_case to match the HubSpot property names; `peerly_identity_id` maps 1:1 to the company property.

## Weekly Tasks Digest Flow

A cron job (`WeeklyTasksDigestService`) fires every Sunday at 11 PM Central Time and sends a `WEEKLY_TASKS_DIGEST` message to the SQS queue. The consumer (`WeeklyTasksDigestHandlerService`) processes all campaigns with a future election date and fires a Segment event per campaign with up to 5 upcoming tasks due Monday through Sunday of the coming week.

The event populates the `win_campaign_plan` fields on the HubSpot contact, which a HubSpot workflow uses to send weekly digest emails.

| Event Name                            | HubSpot Contact Fields                                                                                                                                      | Fired From                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `Campaign Plan - Weekly Tasks Digest` | `plan_tasks_completed`, `plan_total_tasks`, `task_name_1`-`5`, `task_description_1`-`5`, `task_type_1`-`5`, `task_due_date_1`-`5`, `task_week_number_1`-`5` | `WeeklyTasksDigestHandlerService` (via SQS queue) |

Rules:

- Campaigns with a past election date are skipped
- Campaigns with fewer than 3 incomplete tasks are skipped (stale data prevents HubSpot from sending the email)
- Outreach tasks (`text`, `robocall`, `doorKnocking`, `phoneBanking`) are prioritized
- Task due dates are sent as date-only strings (`yyyy-MM-dd`)

Test script: `scripts/test-weekly-tasks-digest-event.ts`

### Manual Recovery (if the cron fails)

The cron enqueues the window in the SQS message itself, so manual triggering just means sending that same message shape by hand. Do this when the Sunday-night cron didn't fire (or the consumer was down) and you want to backfill HubSpot for the current week.

1. Compute the window in UTC:
   - `windowStart` = the Monday you want to cover, at `00:00:00.000Z`
   - `windowEnd` = the following Monday, at `00:00:00.000Z`
   - (Example for the week of April 20, 2026: `2026-04-20T00:00:00.000Z` → `2026-04-27T00:00:00.000Z`)

2. Send this message body to the gp-api FIFO SQS queue (via AWS Console or CLI):

   ```json
   {
     "type": "weeklyTasksDigest",
     "data": {
       "windowStart": "2026-04-20T00:00:00.000Z",
       "windowEnd": "2026-04-27T00:00:00.000Z"
     }
   }
   ```
   - `MessageGroupId`: `gp-queue-weeklyTasksDigest`
   - `MessageDeduplicationId`: anything unique (e.g. `manual-<timestamp>`)

3. The consumer will query all campaigns, fire Segment events, and refresh the HubSpot contact fields. HubSpot's 5-day staleness check applies to whether the digest email sends — a manual recovery within ~5 days of the intended run should still trigger emails.

## Public Profile Completion Requests

When a visitor on a public `/people/*` page asks an unclaimed person to complete their profile, gp-api fires `Person Profile - Completion Requested`. A HubSpot workflow sends the nudge email off it.

| Event Name                              | Resolves the contact by                                               | Fired From                                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `Person Profile - Completion Requested` | `context.traits.email` — the **subject's** address, not the visitor's | `CrmPersonProfilesService.emitCompletionRequested` (detached from `POST /v1/public-person-profiles/claim-request`) |

Why email and not `personId`: `gp_person_id` is not a unique property in HubSpot, so there is no 1:1 contact to resolve an event to. Email is unique there, which makes the address the only usable join key. The address comes from election-api's `Person.email` (populated by the data platform's person feed) via `GET /v1/persons/:personId/contact-email`, an M2M route that returns the address alone.

The event is emitted server-side for that reason. gp-marketing already fires a browser-side `Person Profile Notify Submitted` for the same submission, but that one measures the funnel and must never carry the address — putting a candidate's email in a public page's network traffic is exactly what election-api's `PERSON_PII_COLUMNS` exists to prevent. The two events are not duplicates and should not be deduplicated against each other.

Rules:

- Only `notify` submissions (a visitor nudging someone else) fire it — an owner claiming their own page does not.
- No address on file means no event: HubSpot cannot route it to anyone, so sending it would only orphan a record. Watch `person_profile_completion_request_event_count_total{result="no_email"}` — that share is the ceiling on deliverable nudges, and it moves with data coverage rather than with this code.
- The claim request's id is the Segment `messageId`, which collapses a replay onto one email within Segment's deduplication window (~24h). That covers any retry; it is not a permanent guarantee.

### This creates HubSpot contacts, and that costs attribution

The people these forms appear on are unclaimed by definition, so most have no HubSpot contact. `CrmPersonProfilesService.syncClaimRequestCount` refuses to create one — a visitor nudging someone should not mint a CRM record for them — but the event half cannot honor that and still work: the nudge is only deliverable if a contact exists, so for exactly that population the cloud-mode destination creates it.

Per "Signup Attribution: Forms API with hutk" below, a contact the Segment destination creates is attributed to **offline sources**, and original source is immutable after creation. So a candidate who gets nudged and later signs up through paid or organic search is permanently credited to the nudge instead. This is an accepted trade — an undeliverable nudge is worth less than the attribution — but two things follow from it:

- Acquisition reporting on candidates who have a public profile is affected by this feature. Do not read offline-source growth there as a channel shift.
- `person_profile_completion_request_contact_gap_count_total{result="new_contact"}` counts the contacts created this way, versus `existing_contact` for events that landed on a record that already existed. Check it before widening the feature; if `new_contact` dominates, the attribution cost is larger than the nudge volume suggests.

## Event Definitions

File: `src/vendors/segment/segment.types.ts`

```typescript
EVENTS.CandidateWebsite.Published // 'Candidate Website - Published'
EVENTS.CandidateWebsite.PurchasedDomain // 'Candidate Website - Purchased domain'
EVENTS.Outreach.ComplianceFormSubmitted // 'Voter Outreach - 10DLC Compliance Form Submitted'
EVENTS.Outreach.CompliancePinSubmitted // 'Voter Outreach - 10DLC Compliance PIN Submitted'
EVENTS.Outreach.ComplianceCompleted // 'Voter Outreach - 10DLC Compliance Completed'
EVENTS.Outreach.PeerlyIdentityIdCreated // 'Peerly Identity ID Created'
EVENTS.CampaignPlan.WeeklyTasksDigest // 'Campaign Plan - Weekly Tasks Digest'
EVENTS.PersonProfiles.CompletionRequested // 'Person Profile - Completion Requested'
```

## Segment Configuration

### Sources

- **API** - All events from gp-api

### Destination: HubSpot Cloud Mode (Actions)

Key mappings:

- **Firehose Event V2** - Sends all Track events as `pe21589597_segment___all_track` custom events
- The `Name` property contains the event name that workflows match against

## Signup Attribution: Forms API with hutk

Contacts created by the Segment cloud-mode destination are attributed to
**offline sources** in HubSpot, and original source is immutable after contact
creation — so paid/web attribution is lost if Segment creates the contact.

To preserve attribution, the webapp posts the visitor's `hubspotutk` cookie to
`POST /v1/users/me/crm-registration` on a fresh signup
(`app/post-auth-redirect/page.tsx`), and gp-api submits the HubSpot
registration form (`UsersService.submitRegistrationCrmForm`) with
`context.hutk` — a Forms API submission carrying `hutk` is the only
server-side path HubSpot credits to the visitor's web session. This runs
before the first Segment identify for the user so the form submission, not
the Segment destination, creates the contact.

## HubSpot Data Flow: Contact → Company

Segment identifies users by email, so events land on the **contact** record first. HubSpot workflows then copy the `10 DLC Compliance Status` from the contact to its associated **company**.

A company can have multiple contacts, but the expectation is a 1:1 relationship between a contact and a company. The `10 DLC Compliance Status` on the **company** is what downstream HubSpot automations (e.g. compliance reminder emails) key off of. The drift report (`scripts/10dlc-status-drift-report.ts`) checks the status on the company record for this reason.

## Single-Send API Path (ENG-11034)

`HubspotSingleSendService` (`src/crm/hubspotSingleSend.service.ts`) sends a
transactional email directly via HubSpot's marketing single-send API
(`client.marketing.transactional.singleSendApi.sendEmail`), instead of
Segment event → HubSpot workflow → email. Recipient and content are explicit
call parameters, not resolved from the HubSpot contact record — a
merged/secondary contact can't misroute the address or render stale content.

The PIN Sent / PIN Resent notification (`campaignTcrCompliance.service.ts`)
is the first path cut over. It still fires `CompliancePinSent` /
`CompliancePinResent` as before (other workflows/Zaps key off those events
for non-email actions); only the email leg moved. The asset id is
`HUBSPOT_PIN_SENT_EMAIL_ID` — unset (every environment today, pending the
Ops-created asset) skips the single-send call with no behavior change.

The seven robocall payment/receipt milestones (ENG-11035, see the
"Robocall payment / receipt" table above) are the second batch cut over,
via the shared `OutreachRobocallSingleSendService`. Same shape: each
Segment event keeps firing unchanged, each asset id env var is unset today,
and a HubSpot failure is logged and swallowed rather than thrown — several
of these fire from an SQS consumer or alongside a payment capture, where a
thrown error would redeliver a queue message or fail a completed capture.

## HubSpot Workflow Configuration

Workflows trigger on:

```
pe21589597_segment___all_track has been completed any number of times
AND Name is equal to any of: [event name]
```

Actions:

1. Set `10 DLC Compliance Status` on the contact
2. Copy `10 DLC Compliance Status` to the associated company

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

## Door Knocking Canvassing Totals

`DoorKnockingStatsService` fires `Door Knocking - Canvassing Totals Updated`
with the organization's nine canvassing running totals — on turf create, on
turf complete, and from a daily sweep over orgs that recorded a knock in the
last 24 hours.

| Event Name                                  | HubSpot Target                                        | Fired From                                      |
| ------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| `Door Knocking - Canvassing Totals Updated` | Nine properties on the contact, copied to the company | `DoorKnockingStatsService.emitCanvassingTotals` |

**The workflow does not exist yet, and nothing reaches HubSpot until it does.**
CS needs one workflow keyed on the exact event name that copies each property
below onto the contact and then onto the associated company. Everything the
event carries, in the camelCase the payload uses:

| Property                | Type               | Means                                                                                             |
| ----------------------- | ------------------ | ------------------------------------------------------------------------------------------------- |
| `uniqueDoorsKnocked`    | number             | Distinct doors where somebody behind them has an answer written down                              |
| `doorAttempts`          | number             | Every knock recorded, repeat visits included                                                      |
| `uniqueContactsMade`    | number             | People who came to the door, counted once each                                                    |
| `totalContactsMade`     | number             | Conversations at the door, counted every time                                                     |
| `committedVoters`       | number             | Latest door-knock answers are `supporter` **and** will-vote `yes`                                 |
| `votersPersuaded`       | number             | Answered `non_supporter` at one door and `supporter` at a later one                               |
| `uniqueTurfsCreated`    | number             | Lists drawn and still held                                                                        |
| `uniqueTurfsCompleted`  | number             | The subset marked done                                                                            |
| `lastCanvassActivityAt` | ISO string \| null | The newest knock's timestamp                                                                      |
| `organizationSlug`      | string             | Attribution                                                                                       |
| `campaignId`            | number \| null     | Attribution; null for a Serve (`eo-`) org                                                         |
| `email`                 | string \| null     | The acting user's, also present as a context trait                                                |
| `hubspotContactId`      | string \| null     | The acting user's, also present as a context trait                                                |
| `hubspotCompanyId`      | string \| null     | `campaign.data.hubspotId`; null until the first CRM sync back-fills it, and always null for Serve |

Notes:

- **Every number is a running total, deliberately.** A workflow can copy a
  value onto a property but cannot sum across events, so the property should be
  SET from the event, never incremented.
- Property keys are camelCase here (the analytics standard) rather than
  snake_case matching HubSpot internal names, unlike `Peerly Identity ID
Created` above. The workflow maps them.
- The full metric definitions, including the `refused_to_engage` judgement call
  in the two contacts-made numbers, live in
  `packages/gp-api/docs/door-knocking.md` § The canvassing totals rollup.

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
EVENTS.DoorKnocking.CanvassingTotalsUpdated // 'Door Knocking - Canvassing Totals Updated'
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

## HubSpot Workflow Configuration

Workflows trigger on:

```
pe21589597_segment___all_track has been completed any number of times
AND Name is equal to any of: [event name]
```

Actions:

1. Set `10 DLC Compliance Status` on the contact
2. Copy `10 DLC Compliance Status` to the associated company

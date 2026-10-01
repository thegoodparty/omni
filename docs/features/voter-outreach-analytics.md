# Voter outreach analytics

One event per outreach campaign, with a channel property — not one event per
channel. This file is the contract for the four events that answer "did this
candidate do outreach, through what, and to how many people."

## Why

Three per-channel completion events (`Outreach - Door Knocking: Complete`,
`Outreach - Phone Banking: Complete`, `Outreach - Social Media: Complete`) went
dark in late August when the v2 outreach hub replaced the surfaces that fired
them, and `ce:Outreach - All` unioned them. It was worse than that:
when the legacy `TaskFlow` tree was deleted, `Outreach - Campaign
Completed` was left firing from exactly two places — a native door-knocking
walk session and the campaign-manager log-progress modal. **Text, robocall,
social and phone banking recorded no completion at all.** Any outreach figure
spanning September undercounts; an onboarding→outreach funnel reads 1.38% over
the last 50 days against 2.55% over a clean pre-break window.

Adding a fourth per-channel event would repeat the failure. One event with a
channel property cannot go dark one channel at a time without the channel
breakdown showing it.

## The fan-out distinction

Most channels are **one-to-many**: one send reaches N voters, and the send is
the unit of completion. Two are **one-to-one**: door knocking and phone banking
reach one voter per action, and the individual door or call is the unit.

That difference rides on the event as `fanout`, so a chart can aggregate
correctly without embedding a channel list:

- **"did outreach"** = `Outreach - Campaign Completed` where
  `fanout = one-to-many`, OR an `Outreach - Door Knocking Door Logged` /
  `Outreach - Phone Banking Call Logged`. A chart reaching back before
  2026-09-29 must also accept `fanout = (none)`: no earlier row carries it, so
  `one-to-many` alone drops all pre-cutover history. `ce:Outreach - All`
  already does this.
- **"voters reached"** = SUM(`recipientCount`) where `fanout = one-to-many`,
  plus COUNT of the two contact events. This measure starts at 2026-09-29.
  Earlier rows carry no `fanout`, and every completion before then was a
  number the candidate typed in (see Migration), so accepting `(none)` here
  would mix self-reported counts into a measured total.

The `fanout = one-to-many` filter is what stops the two one-to-one channels
being counted twice — once per finished list and again per contact.

## Channels

The channel property is **`medium`**, the property the event already had. There
is no new `channel` property: `medium` is what every existing chart filters on,
and forking it would have left two properties meaning one thing.

Its values are the canonical `TaskChannelSchema`
(`packages/contracts/src/campaigns/CampaignTaskCatalog.schema.ts`), so an
outreach event and a campaign-tracker task join on one value.
`outreachChannel()` in `app/dashboard/outreach/util/outreachAnalytics.ts` is the
whole cross-walk from `OutreachType`, and it exists because the two vocabularies
disagree in four places: `p2p` → `text`, `nativeDoorKnocking` → `doorKnocking`,
`nativePhoneBanking` → `phoneBanking`, `events` → `event`.

| `medium`       | Fanout      | Completion fires when                           | `recipientCount` | `price`  |
| -------------- | ----------- | ----------------------------------------------- | ---------------- | -------- |
| `text`         | one-to-many | payment settles (`SmsFlow`)                     | required         | required |
| `robocall`     | one-to-many | the authorization hold settles (`RobocallFlow`) | required         | required |
| `socialMedia`  | one-to-many | Save on the share step (`SocialFlow`)           | **omitted**      | omitted  |
| `doorKnocking` | one-to-one  | a turf is completed (`turfLifecycle.ts`)        | required†        | omitted  |
| `phoneBanking` | one-to-one  | the last entry in a call list is called         | required†        | omitted  |
| `directMail`   | one-to-many | the manual log modal submits                    | required         | omitted  |
| `event`        | one-to-many | the manual log modal submits                    | required         | omitted  |
| `awareness`    | —           | no outreach surface; tracker-only               | n/a              | n/a      |
| `general`      | —           | no outreach surface; tracker-only               | n/a              | n/a      |

† On a one-to-one channel it is the people actually contacted when the list
finished, not the list size.

**`socialMedia` is a new value on `TaskChannelSchema`.** The enum had no social
value: the three social tracker tasks (`schedule-social-posts`,
`social-media-update`, `gotv-social-post`) all carried `channel: 'general'`, and
`awareness` is a grab-bag of ballot-access and voting-milestone dates. Prisma's
`CampaignTaskType` already had `socialMedia` and `buildTrackerStrategy.ts`'s
`FLOW_TYPE_TO_CHANNEL` was missing the entry, so a socialMedia task rendered
with the wrong (clipboard) icon. Adding it fixes that and gives analytics an
honest value in one change.

## Naming, and the Win/Serve split

Every outreach event is named `Outreach - <Channel> <Thing>`, with no colon and
one namespace for both products. `Outreach -` is already live (View Accessed,
Click Create, Action Clicked), so this folds the new events into a prefix that
exists rather than opening a third one.

**Win and Serve are a PROPERTY, not a second event name.** Every payload from
`outreachEventProps` carries `product: 'win' | 'serve'`, and `outreachProduct
(isServe)` is the one place it is derived. Door knocking, phone banking, social
and SMS all run on both surfaces from the same components, so a two-name split
would have doubled the taxonomy and made every cross-product total a union —
structurally the same shape that let the three per-channel Complete events go
dark one at a time. A property is a breakdown; a name is a union somebody has
to remember to write.

Names stay literals rather than being composed from a prefix, because the
event-provenance scanner and the tracking plan find events by grepping for the
literal — a name assembled from parts is a name neither of them can see.

`Door Knocking - Canvassing Totals Updated` is deliberately NOT renamed. It
carries a `DO NOT MODIFY` contract in `gp-api/src/vendors/segment/segment.types.ts`:
a HubSpot workflow triggers on that exact string to copy nine canvassing totals
onto the contact and its company. Renaming it breaks that silently.

### The rename cutover

Amplitude's Govern rename changes an event's DISPLAY name; it does not remap an
event type. So when the code starts firing the new literal, the new name is a
NEW event type and the old one keeps its history under its own name. Every
rename below is therefore recorded as a supersession rather than a rename, and
a chart spanning the cutover has to union the old name with the new, unless
the pair has been joined with Govern's merge (UI only):

| Old name                                                                                     | New name                                         | History                                                                                              |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `Voter Outreach - Campaign Completed`                                                        | `Outreach - Campaign Completed`                  | live since 2025-06-26; merged 2026-09-30                                                             |
| `Voter Outreach - Phone Banking Call List Created`                                           | `Outreach - Phone Banking Call List Created`     | live since 2026-08-27; merged 2026-09-30                                                             |
| `Voter Outreach - Phone Banking Call Sheet Downloaded`                                       | `Outreach - Phone Banking Call Sheet Downloaded` | live since 2026-08-29; merged 2026-09-30                                                             |
| `Outreach - Phone Banking: Call Logged`                                                      | `Outreach - Phone Banking Call Logged`           | live since 2026-09-01; merged 2026-09-30                                                             |
| `Outreach - Phone Banking: Contact Viewed`                                                   | `Outreach - Phone Banking Contact Viewed`        | live since 2026-08-29; merged 2026-09-30                                                             |
| `Door Knocking - Door Logged`                                                                | `Outreach - Door Knocking Door Logged`           | live since 2026-08-19; merged 2026-09-30                                                             |
| `Door Knocking - List Created`, `Session Started`, `Session Abandoned`                       | `Outreach - Door Knocking <Thing>`               | merged 2026-09-30                                                                                    |
| `Door Knocking - Route Build Failed`                                                         | `Outreach - Door Knocking Route Build Failed`    | merged 2026-10-01                                                                                    |
| `Door Knocking - Session Completed`, `List Deleted`, `List Edited`, `Not A Voter Reason Set` | `Outreach - Door Knocking <Thing>`               | 33 events in all; left unmerged by decision, so a chart spanning the cutover unions both names       |
| `Dashboard - Campaign Task Status Updated`                                                   | `Dashboard - Campaign Task Completed`            | dark since 2026-09-01; merged 2026-09-30, so the series before the cutover also holds un-completions |

Every old name above now carries its `supersession:` line in Amplitude, so a
chart author lands on where the series continues. The eleven that were
ingesting without being in the tracking plan were adopted into it first, since
Amplitude refuses metadata on an unplanned event.

`Dashboard - Campaign Task Completed` also narrows: it fires on **completion
only**. Un-completing a task is a correction, not an activation signal, and an
event named Completed must not fire on one.

## One channel property, not two

`medium` and `channel` both meant "which channel", on disjoint sets of events —
`medium` on the completion events, `channel` on the funnel and lifecycle ones —
and no event carried both. The values disagreed too: a text send had four
spellings (`text`, `p2p`, `sms`, `texting`), social had two (`socialMedia`,
`social`), and `channel` carried a cased `Phone Banking` with a space.

That mattered most on the v2 funnel, which runs Flow Step Viewed → Flow Step
Completed → Campaign Completed. The first two carried `channel` and the last
`medium`, with different spellings, so building that funnel meant switching
both property name and value on the final step. That is the same fork this
document argues against, one event apart instead of one property apart.

**`medium` is the standard**, because Campaign Completed carries the query
volume worth protecting. `medium` is now sent **alongside** `channel` on the
events that only had `channel`, so every existing chart keeps working:

| Event                                        | Where it fires                          |
| -------------------------------------------- | --------------------------------------- |
| `Voter Outreach - Flow Step Viewed`          | `OutreachFlowShell`                     |
| `Voter Outreach - Flow Step Completed`       | `OutreachFlowShell`                     |
| `Voter Outreach - Recommended List Accepted` | `useOutreachAudience`, `CreateListFlow` |
| `Voter Outreach - Recommended List Failed`   | `useOutreachAudience`                   |
| `Voter Outreach - Campaign Approved`         | gp-api `outreachSmsAdmin`               |
| `Voter Outreach - Campaign Scheduled`        | gp-api outreach/social/robocall         |

Dropping `channel` is a later pass, once nothing reads it.

Each surface keeps its own prop type — the flow shell's is
`'sms' | 'robocall' | 'social' | 'phone-bank' | 'door'`, the audience hook's is
a `ReachabilityKey` —
and `outreachChannel()` folds those spellings onto the one vocabulary, so a
surface never has to rename its own prop to report a correct `medium`.

`Briefing Assistant - Share Completed` and
`Voter Data - Custom Voter File: Select Channel` keep `channel` alone: they are
different features and their `channel` is not an outreach channel.

## Events

### `Outreach - Campaign Completed` (live; extended)

The campaign reached voters. One event, every channel.

| Property             | Type                                    | Required                                                                            |
| -------------------- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| `medium`             | `TaskChannel`                           | always                                                                              |
| `fanout`             | `'one-to-many' \| 'one-to-one'`         | always                                                                              |
| `product`            | `'win' \| 'serve'`                      | always                                                                              |
| `recipientCount`     | number                                  | always **except** `socialMedia`, where it is omitted entirely (never 0, never null) |
| `voterContacts`      | number                                  | mirrors `recipientCount` exactly, including its omission                            |
| `sendDate`           | ISO date `YYYY-MM-DD`                   | always                                                                              |
| `price`              | number (dollars actually paid)          | paid channels only; **omitted** on social, phone banking and door knocking          |
| `outreachCampaignId` | number                                  | when the client holds the envelope id                                               |
| `listId`             | number                                  | the parent list — the turf, the call list, or the audience list                     |
| `trackerTaskId`      | string (cuid)                           | when launched from a tracker task                                                   |
| `phase`              | `preLaunch \| launch \| active \| gotv` | with `trackerTaskId`, never alone                                                   |
| `audienceSource`     | `'recommended' \| 'savedList'`          | when the audience step ran                                                          |
| `campaignName`       | string                                  | the name the candidate gave it; **omitted** where nothing is named                  |
| `method`             | `'manual' \| 'turf' \| 'campaign'`      | on the paths that need disambiguating                                               |

`sendDate` is the scheduled or actual send date, **not** the event timestamp —
paid sends are scheduled days ahead.

`price` is the amount actually paid, in dollars: 0 is a real value on a paid
channel (a send fully covered by the free-texts offer is a zero-cost text
campaign), and the property is **absent** on a channel with no cost at all.

`product` is the Win/Serve cut. It is a property rather than a second event
name for the reason in Naming above, and `outreachProduct(isServe)` is the one
place it is derived — the one required input on `OutreachEventInput`, so a
shared surface that forgets it fails the typecheck rather than reporting every
Serve campaign as Win.

`campaignName` carries the title the candidate gave the campaign: the flow's
own name field on text, robocall, social and phone banking, and the turf name
on door knocking. It is **omitted** where nothing is named — the campaign
manager's manual log and the tracker's count modal record work done offline
against no campaign, and the pre-consolidation code sent the literal string
`'null'` there, which charted as a campaign called "null".

### `Outreach - Campaign Created` (new)

The campaign exists but has reached nobody yet. **Fires on every channel**, and
always before Completed, so created → completed is one funnel with no
channel-shaped hole in it:

| Channel        | Created fires when                                     |
| -------------- | ------------------------------------------------------ |
| `text`         | the `pending_payment` draft is created (review entry)  |
| `robocall`     | the `pending_payment` draft is created (pay step)      |
| `socialMedia`  | Save — the same press as Completed, immediately before |
| `doorKnocking` | per turf, on the create flow's press                   |
| `phoneBanking` | the call list is created                               |

A **gated** candidate (`outreach-pro-gating-v2`, milestone 2) never reaches the
review or pay step, so for text and robocall the event fires off the `draft`
row the gate saves instead — that row IS the campaign, existing and having
reached nobody, which is what this event reports. Resuming that draft converts
it in place, so the review and pay paths skip the fire (`resumed`) rather than
counting one campaign as two. Without this the free-tier candidate — the one
the activation work most needs to see — would be the one going unreported.

The gap between Created and Completed is what differs: seconds on social,
minutes on a paid send, and days on the two one-to-one channels, where the list
is built long before anyone works it. Social converts at 100% by construction,
which is the honest reading rather than a hole in the funnel.

Same properties as Completed minus `price` (nothing is paid yet);
`recipientCount` is the audience or list size, and `sendDate` rides along on
the channels that already know it.

`Door Knocking - List Created` and `Outreach - Phone Banking Call List
Created` keep firing alongside and are **not** superseded. They are channel
diagnostics: the door-knocking one carries route geometry (`stops`, `loop`,
`mode`, `suggestedMode`), the phone-banking one carries batch sizing
(`listSize`, `filtersApplied`). Neither is comparable across channels; this one
is, which is what makes a created → contacted → completed funnel countable.

### `Outreach - Door Knocking Door Logged` / `Outreach - Phone Banking Call Logged`

One door, one call. Both keep every property they had and gain `medium`,
`fanout` and the parent `listId`. On a one-to-one channel these are the
per-voter completion signal; the campaign event fires once for the whole list.

### `Voter Outreach - Flow Step Viewed` / `Flow Step Completed` (extended)

The per-stage funnel, now fired by every channel flow: phone banking and door
knocking joined text, robocall and social. Both events add two properties.

| Property | Values                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------- |
| `source` | `outreach_page`, `draft`, `campaign_plan`, `campaign_manager`, `voter_data`, `door_knocking_page`, `deep_link` |
| `locked` | `true` when this attempt started behind the Pro wall, `false` when it started on an unlocked channel           |

`source` is `OutreachFlowSource` in `outreachAnalytics.ts`, worked out once
per open by whatever opened the flow: the hub for its tiles, draft rows and
compose links, the door knocking page for its create flow. A compose link's
`campaign_tracker` reads as `campaign_plan` here and only here;
`Outreach - Click Create` keeps the old value so its history does not split.
`locked` is frozen once per open (`useLockedAtOpen`), so every stage of an
attempt that started behind the wall reports `true`, including the ones after
an in-flow upgrade. It waits for the gate to resolve before freezing, since
membership loads asynchronously, and the shell holds stage events until then
rather than report a guess.

At the Pro wall the same `source` rides into `Pro Upgrade - Flow Started`,
beside `channel`, the literal `cta` of the button that opened the gate, and
`trackerTaskId` / `phase` when a task started the flow. Campaign manager task
links now carry the tracker task the way campaign plan links do. The Pro side
is documented in `packages/gp-webapp/app/dashboard/pro-upgrade/AGENTS.md`.

### `Dashboard - Campaign Task Status Updated` (revived)

Dark from 2026-09-01 to this change: the legacy dashboard checklist that fired
it was deleted and the campaign tracker that replaced it shipped with no
completion event at all, while task completion was becoming the primary
activation metric. Now fires from the tracker's own toggle with
`trackerTaskId`, `completed`, `medium` and `phase`.

For an outreach task it fires on the count modal's **submit**, not on the first
press — a completion the candidate cancels out of reports nothing — and that
same submit fires `Outreach - Campaign Completed` with `method: 'manual'`,
since the count is a manual outreach log.

## Retirements

| Event                                | Disposition                                      |
| ------------------------------------ | ------------------------------------------------ |
| `Outreach - Door Knocking: Complete` | retired — surface deleted, last fired 2026-08-26 |
| `Outreach - Phone Banking: Complete` | retired — surface deleted, last fired 2026-08-28 |
| `Outreach - Social Media: Complete`  | retired — surface deleted, last fired 2026-08-23 |

All three were dead `EVENTS` constants with no call site; the constants are
gone and the Amplitude events carry `not in use` with their supersession.

`ce:Outreach - All` (492285, 5.3k query volume) has been **renamed** from
`ce:Voter Outreach - All`, which costs nothing: a custom event is a query-time
construct and charts follow its id.

It was redefined on 2026-09-30, after the old names were merged into the new
ones:

1. `Outreach - Campaign Completed` WHERE `fanout` is `(none)` or `one-to-many`
2. `Outreach - Door Knocking Door Logged`
3. `Outreach - Phone Banking Call Logged`

The filter keeps `(none)` because the merges bring every pre-cutover row in
through these members, and none of those rows carry `fanout`. Filtering on
`fanout = one-to-many` alone would drop all history before 2026-09-29. The three
per-channel `: Complete` members were removed; they overlapped with
`Campaign Completed`, so event totals before September read lower than under the
old definition.

## Migration

`Outreach - Campaign Completed` is live with 9,061 query volume. Two
discontinuities land at the cutover, and both are worth knowing before reading
any chart across it.

**1. The series steps UP, because it starts measuring a different thing.**
Every completion in the last 90 days came from just two places: the
campaign-manager log-progress modal (self-reported activity) and a native
door-knocking walk session. Nothing product-observed was counted at all:

| `medium`       | events, 90d to 2026-09-23 | what it actually was           |
| -------------- | ------------------------: | ------------------------------ |
| `text`         |                       175 | a candidate typing a number in |
| `socialMedia`  |                       122 | a candidate typing a number in |
| `doorKnocking` |                       109 | walk sessions + manual logs    |
| `events`       |                        73 | a candidate typing a number in |
| `phoneBanking` |                        28 | a candidate typing a number in |
| `robocall`     |                        27 | a candidate typing a number in |

After the cutover, real sends are counted beside those. **`method` is the cut
that separates them**: `manual` is self-reported, everything else is
product-observed. A chart that does not split on it will show a step change at
the cutover date and read it as growth.

**2. One value changes spelling: `events` → `event`**, to match the contract
enum. That is 73 events over 90 days, and it is the only live value affected —
`p2p`, `nativeDoorKnocking` and `nativePhoneBanking` appear in the cross-walk
defensively but have never been fired on this event. Any chart or cohort
filtering `medium = events` has to accept both spellings across the cutover.

There is no backfill. `fanout` is absent on every pre-cutover row, which is why
`ce:Outreach - All` keeps `(none)` in its `fanout` filter.

One property is dropped: `price: 0` on the manual log — a hardcoded zero
rather than a measurement, so it is now absent where no cost exists and an
average price stops being diluted by it. `method` also loses the value
`native`, replaced by `turf` and `campaign`.

`voterContacts` and `campaignName` are **kept**. `voterContacts` mirrors
`recipientCount`, so a chart built on the retired per-channel Complete events'
property keeps reading; the two are the same number under two names, and the
one to build on is `recipientCount`. `campaignName` now carries the real
campaign title everywhere one exists, and is absent on the two manual-log
paths that name nothing — previously it was the literal string `'null'` on the
only call site that sent it.

Door-knocking volume will FALL even as the rest rises: completion moved off the
walk session, which fired every time a canvasser stopped for the evening, onto
the turf being finished. A fifty-door list walked over three evenings used to
report three campaigns and now reports one.

**Cutover date: 2026-09-29.** The release carrying this change reached prod at
22:09 UTC; the old names last fired before it. Every renamed event's `gp-meta`
block carries the same date.

## Monitoring

A volume anomaly monitor watches `Outreach - Campaign Completed` **grouped by
`medium`** (Amplitude monitor `zxdr3o2w` on chart `xdxrdhf6`, created
2026-10-01): automatic anomaly detection at 99%, drops and spikes, checked
daily. The grouping is the point: one channel dropping to zero alerts instead
of hiding inside a flat total. This is the check that would have caught the
August break in a day rather than a month. The chart starts at 2026-09-30, so
the baseline only sees post-cutover rows.

Not built:

- Volume monitors on `Outreach - Door Knocking Door Logged` and
  `Outreach - Phone Banking Call Logged`. Optional; add them if the campaign
  monitor proves useful.
- A CI check that fails a PR removing an event literal a live Amplitude custom
  event, cohort or saved chart depends on.

## Still open

- **`Campaign Plan - Weekly Tasks Digest`** lost roughly two thirds of its
  weekly audience after 2026-08-31. No change to
  `packages/gp-api/src/campaigns/tasks/` explains it in that window — the only
  commits are a legacy-backend teardown (ENG-11015) and a test-fixtures API —
  so the likely cause is an audience change upstream (the digest mirrors the
  tracker's active-week set, which only exists for the `campaign-story`
  cohort). Needs its own look.

## Related

- `packages/gp-webapp/app/dashboard/outreach/util/outreachAnalytics.ts` — the
  one place the payload is shaped, and where the omission rules live.
- `packages/gp-webapp/helpers/analyticsHelper.ts` — the `EVENTS` map.
- `.claude/skills/event-metadata/SKILL.md` — the `gp-meta` governance block.
- `docs/features/campaign-tracker-v3.md` — the tracker whose tasks this joins to.

# Voter outreach analytics

One event per outreach campaign, with a channel property — not one event per
channel. This file is the contract for the four events that answer "did this
candidate do outreach, through what, and to how many people."

## Why

Three per-channel completion events (`Outreach - Door Knocking: Complete`,
`Outreach - Phone Banking: Complete`, `Outreach - Social Media: Complete`) went
dark in late August when the v2 outreach hub replaced the surfaces that fired
them, and `ce:Voter Outreach - All` still unions them. It was worse than that:
when the legacy `TaskFlow` tree was deleted, `Voter Outreach - Campaign
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

- **"did outreach"** = `Voter Outreach - Campaign Completed` where
  `fanout = one-to-many`, OR a `Door Knocking - Door Logged` /
  `Outreach - Phone Banking: Call Logged`.
- **"voters reached"** = SUM(`recipientCount`) where `fanout = one-to-many`,
  plus COUNT of the two contact events.

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

Every outreach event is named `<Product> Outreach - <Channel> <Thing>`, with no
colon: `Voter Outreach - ...` on Win, `Constituent Outreach - ...` on Serve.
Door knocking, phone banking, social and SMS all run on both surfaces from the
same components, so a shared surface carries TWO literals and
`surfaceEvent(event, isServe)` in `helpers/analyticsHelper.ts` picks between
them at the call site.

Both stay literals rather than being composed from a prefix, because the
event-provenance scanner and the tracking plan find events by grepping for the
literal — a name assembled from parts is a name neither of them can see.

**The cost is real and worth stating: a cross-product total is a union of two
names, which is structurally the same thing that let the three per-channel
Complete events go dark one at a time.** `ce:Voter Outreach - All` is where that
union is absorbed once, centrally, rather than in every chart — which is why
that composite matters more after this change than before it.

`Door Knocking - Canvassing Totals Updated` is deliberately NOT renamed. It
carries a `DO NOT MODIFY` contract in `gp-api/src/vendors/segment/segment.types.ts`:
a HubSpot workflow triggers on that exact string to copy nine canvassing totals
onto the contact and its company. Renaming it breaks that silently.

### The rename cutover

Amplitude's Govern rename changes an event's DISPLAY name; it does not remap an
event type. So when the code starts firing the new literal, the new name is a
NEW event type and the old one keeps its history under its own name. Every
rename below is therefore recorded as a supersession rather than a rename, and
a chart spanning the cutover has to union the old name with the new:

| Old name                                   | New name(s)                                                                    | History                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `Door Knocking - Door Logged`              | `Voter Outreach - Door Knocking Door Logged` / `Constituent Outreach - ...`    | 300 events from 2026-08-19 stay on the old name       |
| `Outreach - Phone Banking: Call Logged`    | `Voter Outreach - Phone Banking Call Logged` / `Constituent Outreach - ...`    | 365 events from 2026-09-01 stay on the old name       |
| `Outreach - Phone Banking: Contact Viewed` | `Voter Outreach - Phone Banking Contact Viewed` / `Constituent Outreach - ...` | 1,675 events stay on the old name                     |
| the rest of `Door Knocking - *`            | `Voter Outreach - Door Knocking <Thing>` / `Constituent Outreach - ...`        | low volume; stays on the old names                    |
| `Dashboard - Campaign Task Status Updated` | `Dashboard - Campaign Task Completed`                                          | already dark since 2026-09-01, so nothing is stranded |

`Dashboard - Campaign Task Completed` also narrows: it fires on **completion
only**. Un-completing a task is a correction, not an activation signal, and an
event named Completed must not fire on one.

## Events

### `Voter Outreach - Campaign Completed` (live; extended)

The campaign reached voters. One event, every channel.

| Property             | Type                                    | Required                                                                            |
| -------------------- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| `medium`             | `TaskChannel`                           | always                                                                              |
| `fanout`             | `'one-to-many' \| 'one-to-one'`         | always                                                                              |
| `recipientCount`     | number                                  | always **except** `socialMedia`, where it is omitted entirely (never 0, never null) |
| `sendDate`           | ISO date `YYYY-MM-DD`                   | always                                                                              |
| `price`              | number (dollars actually paid)          | paid channels only; **omitted** on social, phone banking and door knocking          |
| `outreachCampaignId` | number                                  | when the client holds the envelope id                                               |
| `listId`             | number                                  | the parent list — the turf, the call list, or the audience list                     |
| `trackerTaskId`      | string (cuid)                           | when launched from a tracker task                                                   |
| `phase`              | `preLaunch \| launch \| active \| gotv` | with `trackerTaskId`, never alone                                                   |
| `audienceSource`     | `'recommended' \| 'savedList'`          | when the audience step ran                                                          |
| `method`             | `'manual' \| 'turf' \| 'campaign'`      | on the paths that need disambiguating                                               |

`sendDate` is the scheduled or actual send date, **not** the event timestamp —
paid sends are scheduled days ahead.

`price` is the amount actually paid, in dollars: 0 is a real value on a paid
channel (a send fully covered by the free-texts offer is a zero-cost text
campaign), and the property is **absent** on a channel with no cost at all.

### `Voter Outreach - Campaign Created` (new)

The campaign exists but has reached nobody yet. **Fires on every channel**, and
always before Completed, so created → completed is one funnel with no
channel-shaped hole in it:

| Channel        | Created fires when                                     |
| -------------- | ------------------------------------------------------ |
| `text`         | the `pending_payment` draft is created (review entry)  |
| `robocall`     | the `pending_payment` draft is created (pay step)      |
| `socialMedia`  | Save — the same press as Completed, immediately before |
| `doorKnocking` | per turf, on the create flow's paid press              |
| `phoneBanking` | the call list is created                               |

The gap between Created and Completed is what differs: seconds on social,
minutes on a paid send, and days on the two one-to-one channels, where the list
is built long before anyone works it. Social converts at 100% by construction,
which is the honest reading rather than a hole in the funnel.

Same properties as Completed minus `price` (nothing is paid yet);
`recipientCount` is the audience or list size, and `sendDate` rides along on
the channels that already know it.

`Door Knocking - List Created` and `Voter Outreach - Phone Banking Call List
Created` keep firing alongside and are **not** superseded. They are channel
diagnostics: the door-knocking one carries route geometry (`stops`, `loop`,
`mode`, `suggestedMode`), the phone-banking one carries batch sizing
(`listSize`, `filtersApplied`). Neither is comparable across channels; this one
is, which is what makes a created → contacted → completed funnel countable.

### `Door Knocking - Door Logged` / `Outreach - Phone Banking: Call Logged`

One door, one call. Both keep every property they had and gain `medium`,
`fanout` and the parent `listId`. On a one-to-one channel these are the
per-voter completion signal; the campaign event fires once for the whole list.

### `Dashboard - Campaign Task Status Updated` (revived)

Dark from 2026-09-01 to this change: the legacy dashboard checklist that fired
it was deleted and the campaign tracker that replaced it shipped with no
completion event at all, while task completion was becoming the primary
activation metric. Now fires from the tracker's own toggle with
`trackerTaskId`, `completed`, `medium` and `phase`.

For an outreach task it fires on the count modal's **submit**, not on the first
press — a completion the candidate cancels out of reports nothing — and that
same submit fires `Voter Outreach - Campaign Completed` with `method: 'manual'`,
since the count is a manual outreach log.

## Retirements

| Event                                | Disposition                                      |
| ------------------------------------ | ------------------------------------------------ |
| `Outreach - Door Knocking: Complete` | retired — surface deleted, last fired 2026-08-26 |
| `Outreach - Phone Banking: Complete` | retired — surface deleted, last fired 2026-08-28 |
| `Outreach - Social Media: Complete`  | retired — surface deleted, last fired 2026-08-23 |

All three were dead `EVENTS` constants with no call site; the constants are
gone and the Amplitude events carry `not in use` with their supersession.

`ce:Voter Outreach - All` (492285, 5.3k query volume) is **deliberately not yet
redefined** — the definition it becomes depends on `fanout`, which no row
carries until this ships. Its description records the target definition:

1. `Voter Outreach - Campaign Completed` WHERE `fanout = one-to-many`
2. `Door Knocking - Door Logged`
3. `Outreach - Phone Banking: Call Logged`

## Migration

`Voter Outreach - Campaign Completed` is live with 9,061 query volume. Two
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
`ce:Voter Outreach - All` cannot take its `fanout = one-to-many` filter until
this ships.

Three properties are dropped: `voterContacts` and `campaignName` (superseded by
`recipientCount`; neither had query volume), and `price: 0` on the manual log
(it was a hardcoded zero, not a measurement — the property is now absent where
no cost exists, so an average price stops being diluted by it). `method` also
loses the value `native`, replaced by `turf` and `campaign`.

Door-knocking volume will FALL even as the rest rises: completion moved off the
walk session, which fired every time a canvasser stopped for the evening, onto
the turf being finished. A fifty-door list walked over three evenings used to
report three campaigns and now reports one.

**Cutover date: TBD — stamp it here and on the event's `gp-meta` block when
this reaches prod.** Prod is reached only by the release train, so the date is
not knowable at merge.

## Monitoring

Not yet built — the new events have no data to alert on until this ships. What
to create at cutover:

- A volume anomaly monitor on `Voter Outreach - Campaign Completed` **grouped
  by `medium`**, so one channel dropping to zero alerts instead of hiding
  inside a flat total. This is the check that would have caught the August
  break in a day rather than a month.
- Volume monitors on `Door Knocking - Door Logged` and
  `Outreach - Phone Banking: Call Logged`.
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

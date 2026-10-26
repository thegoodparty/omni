# Flows: managed civic panel

<!-- Moved verbatim from contacts/AGENTS.md so the auto-loaded AGENTS.md stays small. Edit here. -->

### Managed civic panel

For offices in `serve-citizen-panels`, GoodParty builds the panel for them
(`docs/adr/2026-10-22-managed-civic-panel-replaces-build-plan.md`); there is
no way for an official to build one themselves. The official approves once, in their own name; GoodParty then sends free,
texts-only waves of that one invite until members reach the district goal.

**The Chief of Staff is the only way in.** With the flag on, the card sync
(`DashboardCardsService.syncManagedCivicPanelCard`) gives every office with
no enrollment one card (`sourceExternalId` from contracts'
`managedCivicPanelCardSourceId`, `managed-panel:<electedOfficeId>`), stored
with the placeless words (`managedCivicPanelCardContent(null)`, Build my
civic panel); the home draws it with the office's place. It has no Mark done,
does not lapse, and is done while an enrollment that is not stopped exists
(a stopped one opens it again; a skip stays a skip). Its button, and the
intro's Build my civic panel, send the hidden
`START_MANAGED_CIVIC_PANEL_MESSAGE`; the chat (`managedCivicPanel.tools.ts`,
`managedCivicPanelBlock` in the Chief of Staff prompt) explains with fixed
words (`explain_managed_panel`: contracts' `managedCivicPanelExplanation`,
and `managedCivicPanelHowItWorks` with the place, the seats and the census
share of adults 65 or older from `ManagedCivicPanelService.explainerFacts`,
falling back to a sentence without numbers), offers the
invite (`offer_managed_panel_invite`), shows it
(`present_managed_panel_invite`), and the webapp's text flow approves it
(POST, with contracts' `MANAGED_CIVIC_PANEL_CONSENT_VERSION`). The flow's
close sends a hidden `MANAGED_CIVIC_PANEL_SET_UP_MESSAGE` or
`MANAGED_CIVIC_PANEL_BACKED_OUT_MESSAGE`; on set up the agent reads
`read_managed_panel` (status, members, goal, the first send date,
`nextManagedSendDate` from the approval, and the week it should be
ready, two weeks of waves later) and shows `present_managed_panel`.

**Once approved, one progress card.** The same sync gives an approved
office one card at a time (`syncManagedPanelProgressCard`,
`sourceExternalId` from contracts' `managedCivicPanelProgressCardSourceId`,
`managed-panel-progress:<electedOfficeId>`, `sourceItemId` the phase from
`managedPanelPhase`): `building` (building or paused: "Your civic panel is
filling up", or "Your civic panel starts here" at 0 members as on the civic
panel page, members of the goal and the next send date, or "Invites are
paused"), `ready` (for `MANAGED_PANEL_READY_CARD_DAYS`, 14, after
`readyAt`), and `exhausted` ("Every resident we can text has an invite",
members of the goal, button `MANAGED_CIVIC_PANEL_EXHAUSTED_CARD_CTA`, which
the home turns into the hidden `MANAGED_CIVIC_PANEL_EXHAUSTED_MESSAGE` so
the Chief of Staff says so with the member count). Stopped, or no enrollment: none. An open
card of another phase is deleted, so a building card set aside never hides
the ready one; words are rewritten on read; no Mark done; building and
exhausted do not lapse. The read goes through `ManagedCivicPanelService`
(by `ModuleRef`, before the lock) and a failed read leaves the card alone.
The Chief of Staff (`managedCivicPanelBlock`, `read_managed_panel`)
answers in each status's words. The civic panel page's rail shows
`ManagedPanelControls` (the Invites card): the status, the next send day
and ready week while building, Pause, Resume and Stop (with a confirm),
each the `PATCH` below.

`ManagedCivicPanel` is one row per office (`organizationSlug` unique), kept
when stopped so `freeTextsUsed` still counts against `freeTextCap` (15,000)
if it is approved again. `status` is `building`, `ready`, `paused`,
`stopped` or `exhausted`. `ManagedPanelWave` is one row per wave (`wave`
unique per enrollment), with the drawn list (`voterFileFilterId`),
`steeredToward`, `sentAt`, `replyWindowEndsAt`,
`closedAt` and `joinedMembers`. Its send links the other way,
through `Outreach.managedPanelWaveId` (unique), so a free send's funding and
its wave sit on one row a CHECK holds together.

**Free sends.** A wave's send is free only through
`ManagedWaveFundingService.claimFree(waveId)` (`src/managedWaveFunding/`),
the one code path that sets `Outreach.fundedBy`. It has no route, and an
import test fails the build if a controller, chat tool or request-serving
service imports it. In one transaction it refuses unless the wave has a Serve `text` send in
`pending_payment` with no checkout session and no funding, in the
enrollment's own org, carrying exactly `inviteMessage`; the enrollment is
`building`, still has its approver, and `serve-citizen-panels` is on for that
approver; and `textCount` fits in `freeTextCap - freeTextsUsed`. It then
claims the send `pending_payment -> pending` the way the SERVE_TEXT purchase
does, stamps `fundedBy: goodparty_pilot` and `billableTextCount`, adds to
`freeTextsUsed`, enqueues `outreachTextSend`, and posts a "pilot wave queued"
notice naming the office to #bot-tevyn-api. An enqueue failure undoes all of
it, under the same enrollment lock. Calling it again for a wave its own
earlier claim left `pending` (a crash between commit and enqueue) re-enqueues
it without counting its texts again, but only while the panel is `building`. A wave over the cap pauses the panel,
re-checked under the lock so a reverted sibling's texts are counted first,
and posts a cap notice instead. The
delivery layer checks the funding again before it hands a send off
(`outreach/docs/text-delivery.md`, "The funding gate"), and a daily job
reconciles every unpaid send. `serve-citizen-panels` is the only switch:
off for the approving official, and neither the claim nor the send-time
gate lets anything of theirs go out free. Decision:
`docs/adr/2026-10-22-managed-panel-free-sends-and-guards.md`.

The routes (`/v1/contacts/civic-panel/managed`, `ManagedCivicPanelService`,
contracts in `people/ManagedCivicPanel.schema.ts`) are gated like every
panel route: 404 with the flag off, 400 for a non-`eo-` org.

- `GET` returns `{ panel }`, null before approval. `progress` is the
  members (the standing `member` set, as the summary counts them),
  `goalMembers`, `wavesSent` (waves with `sentAt`), `nextWaveAt`: while
  building, the latest sent wave's `replyWindowEndsAt`, else null, and
  `firstSendDate` / `readyWeekOf` (yyyy-MM-dd, `managedPanelSchedule` in
  `utils/managedPanelSchedule.util.ts`): `nextManagedSendDate` from the
  approval and the Monday of the week two weeks of waves later, the same
  days `read_managed_panel` tells the official.
- `POST { inviteMessage, consentVersion }` approves. The invite must carry
  a civic panel wording of the JOIN line (the current
  `CIVIC_PANEL_JOIN_LINE`, or an earlier civic panel wording a draft may
  already hold, never a citizens' panel one), no LEAVE line, and pass
  `assertServeSmsLockedLines` (the STOP opt-out, one panel line), within
  `SMS_COMPOSED_MAX_LENGTH`. It stores the approver and time, sets
  `goalMembers` to the district's `panelGoalMembers`,
  and starts `building`. Idempotent per office: an enrollment that is not
  stopped comes back unchanged; a stopped one is approved again in place.
- `PATCH { action }`: `pause` from building, `resume` from paused, `stop`
  from building, paused, ready or exhausted. Anything else is a 409; no enrollment is a 404. Each write is conditional on the status it leaves from.
  A 409 means the status moved since the page loaded, so the Invites card
  reads the enrollment again and redraws instead of offering Try again.

**Drawing a wave** (`ManagedPanelWaveDrawService.drawNextWave`, no route).
It draws a building enrollment's next wave and sends nothing. A wave not yet
sent (`sentAt` null) comes back as `pending` instead of a new draw, so there
is one unsent wave at a time. The insert runs under an advisory lock per
enrollment that re-checks for an unsent wave, so of two overlapping draws
one makes the wave and the other drops its list and returns it. Otherwise:

- Size: the member gap (`goalMembers` minus the standing members) at the
  cold `PANEL_SEED_ASSUMED_JOIN_RATE`, capped at the reachable cell phones,
  `MAX_LIST_SAMPLE_SIZE` and the free texts left (`freeTextCap` minus
  `freeTextsUsed`). `textInviteSize` in `utils/civicPanelInvite.util.ts`.
- Who: `CIVIC_PANEL_INVITE_CRITERIA` (`civicPanelNeverInvited`,
  `notContactedRecently`, `hasCellPhone`: so no member, nobody who left,
  nobody already invited, nobody reached in 30 days), leaving out by id
  everyone an earlier wave drew and everyone opted out of the office's
  texts (`drawListSample`'s server-only `excludePersonIds`). The draw is
  frozen.
- Lean: `panelSteering` over the members' census cells ("Steering by
  census"); `steeredToward` is `inviteLean`'s group. A failed census read
  leans nowhere.
- Saved as a hidden list (`civicPanelInvite`, `civicPanelInviteListName`:
  "Civic panel invite", then "Civic panel invite, batch 2") and a
  `ManagedPanelWave` row with the next `wave`.

It returns `drawn` or `pending` (with the wave and its list's size), or,
drawing nothing, `goal_reached`, `out_of_free_texts`, `not_building`, or
`exhausted` when nobody is left to text. A wave goes out on
`nextManagedSendDate(now)` (`outreach/services/outreachServeSmsCreate.service.ts`):
the third business day, the earliest `assertServeSmsSendDateAllowed`
accepts, so staff get their full lead.

**The wave job** (`src/managedPanelWaves/`, `ManagedPanelWaveJobService`,
`managedPanelWaves` at 8:19 ET daily, dev and prod only, one pass per day
under `CronLockService`). For each `building` enrollment whose approver has
`serve-citizen-panels`, one step from what the rows say:

- An unsent wave (`sentAt` null) is sent: its send is made if it has none,
  claimed through `claimFree`, and the wave marked sent with
  `replyWindowEndsAt` `MANAGED_WAVE_REPLY_DAYS` (5) days after the send date.
- A sent wave inside its window waits. Past it, the wave is closed
  (`closedAt`, and `joinedMembers`: the people its list drew who are members
  now; JOIN replies make them members through the reply ingest).
- With no open wave: members at the goal mark the panel `ready`
  (`readyAt`); otherwise `drawNextWave` draws the next and it is sent.
  `exhausted` from the draw, or a list that reaches nobody (the wave and its
  list are dropped), marks the panel `exhausted`; `out_of_free_texts`
  pauses it and posts a cap notice, as `claimFree` does for a wave over the
  cap.
- After the step loop, every `ready` enrollment with `readyEmailSentAt`
  null whose approver still has the flag gets one "Your civic panel is
  ready" email (`EmailService.sendEmail`, Mailgun) to the approver. The
  stamp is claimed before the send and handed back if it fails, so the
  next run retries and two runs never both send. A stopped panel approved
  again clears it.

The send is a Serve `text` row in `pending_payment` with `managedPanelWaveId`
(unique, so a retry never makes two), the enrollment's `inviteMessage`
re-checked as the approval checks it (`assertManagedPanelInvite`),
`asksToJoinCivicPanel`, the wave's list, `textCount` counted as a draft is
(`resolveListAudienceCount`), and `nextManagedSendDate`. It has no
25-recipient floor: that floor is the checkout's, and a free send has none.
An unclaimed draft from an earlier run gets today's send date and the
current invite before it is claimed. A retry is safe at every point: a claim
left `pending` is resumed by `claimFree`, and a send already past `pending`
only gets its wave marked. Paused, stopped, ready and exhausted panels are
not touched. Decision:
`docs/adr/2026-10-22-managed-panel-wave-job-derives-each-step.md`.

**Analytics** (`EVENTS.Contacts` in `segment.types.ts`, to the office's
user through `trackForOffice`, fire-and-forget). Each fires only from the
write that changed the row, so a retry or a second run never counts twice.

- `Contacts - Civic Panel Invite Approved` (`approve`, only an approval this call made):
  `goalMembers`, `freeTextCap`, `firstSendDate`, `reapproval` (a stopped
  enrollment approved again), `product: serve`.
- `Contacts - Civic Panel Status Changed` (`managedPanelStatusChanged` in
  `utils/managedPanelAnalytics.util.ts`): `from`, `to`, `members`,
  `changedBy`. `official` from the PATCH and a re-approval, `system` from the
  wave job (ready, exhausted, paused out of free texts) and `claimFree`'s
  pause at the cap. Nothing writes `manual` yet: nothing sets it by hand.
- `Contacts - Civic Panel Wave Sent` (the wave marked sent): `wave`, `texts`, `sendDate`,
  `steeredToward`.
- `Contacts - Civic Panel Wave Closed`: `wave`, `invited` (the people its list drew),
  `joinedMembers`, `membersAfter`.
- `Contacts - Civic Panel Ready` (with the status change to ready): `members`,
  `goalMembers`, `wavesSent`, `daysToReady` (calendar days from the latest
  approval). The ready email has no event of its own.

The browser fires the setup steps (`EVENTS.Contacts` in the webapp's
`analyticsHelper.ts`): Civic Panel Managed Invite Value Prop Viewed and
Completed, then Civic Panel Invite Viewed, Review Viewed, Review Dismissed
and Submitted. See the
webapp's `shared/agent-chat/AGENTS.md`.

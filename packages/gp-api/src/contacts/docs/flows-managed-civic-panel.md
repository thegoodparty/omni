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
invite (`offer_managed_panel_invite`), and shows the invite card
(`present_managed_panel_invite`: Your civic panel invite, Text to <place>
residents, Review the invite; the offer's answer has the same words,
contracts' `SHOW_MANAGED_CIVIC_PANEL_INVITE`). The card never shows the
words; the card opens the webapp's text flow on its own when it is drawn,
and its Review the invite opens it again; that flow is where they are shown
and edited. The body is the official's full name, office and place, and it
never names the civic panel; "Reply JOIN to share your perspectives." and
"Reply STOP to opt out." follow as one block. There is no checkbox: Set up my
civic panel is the approval (POST, with contracts'
`MANAGED_CIVIC_PANEL_CONSENT_VERSION`), right under one line: "By continuing,
you agree to GoodParty texting this invite to <place> residents in your name."
The flow's
close sends a hidden `MANAGED_CIVIC_PANEL_SET_UP_MESSAGE` or
`MANAGED_CIVIC_PANEL_BACKED_OUT_MESSAGE`; on set up the agent reads
`read_managed_panel` (status, members, goal, the first send date,
`nextManagedSendDate` from the approval, and the week it should be
ready, two weeks of waves later) and shows `present_managed_panel`.
Until the first wave sends, `read_managed_panel` also returns `headsUp`
(the Chief of Staff only, which passes the official's name): contracts'
`managedCivicPanelHeadsUpLine` (with the first send's weekday) and
`managedCivicPanelHeadsUpPost`, built by
`ManagedCivicPanelService.headsUpPost` from the place, the name and the
org's position name. The agent says the line and presents the post as an
ordinary social `present_outreach_proposal` (audience "Your followers",
count 0), which opens the Serve social flow on it.

**The heads-up post card.** The sync also keeps one card for that post
(`syncManagedHeadsUpCard`, `managed-panel-heads-up:<electedOfficeId>` from
contracts' `managedCivicPanelHeadsUpCardSourceId`, null `sourceItemId`),
due noon UTC on the first send day: made while the panel is `building`
with no wave sent and no social outreach saved by the org since
`approvedAt`, completed once either happens. A pause leaves it open; a
stop deletes it while open, so approving again makes a fresh one. The
per-priority sync keeps it
out of its delete like the other managed cards. Skip works as on the other
civic panel cards; no Mark done. The home draws its words with the place
(`managedCivicPanelHeadsUpCardContent`) and its Start the post opens the
Serve `SocialFlow` over the home on the same post.

**Once approved, one progress card.** The same sync gives an approved
office one card at a time (`syncManagedPanelProgressCard`,
`sourceExternalId` from contracts' `managedCivicPanelProgressCardSourceId`,
`managed-panel-progress:<electedOfficeId>`, `sourceItemId` the phase from
`managedPanelPhase`): `building` (building or paused: "Your civic panel is
filling up" with "{members} {place} residents are ready to share their
views" (the place from `ManagedCivicPanelService.districtPlace`, looked up
only while this card or the ready card shows; a found place is cached in
process for 24 hours, keyed on the org's slug, position and district
override), or "Your civic panel starts here" at 0 members as on
the civic panel page with members of the goal, then the next send date; or
"Invites are paused"), `ready` (for `MANAGED_PANEL_READY_CARD_DAYS`, 14, after
`readyAt`), and `exhausted` ("Every resident we can text has an invite",
"{members} of {goal} residents have joined. Door knocking and calls can
reach the rest.", one button `MANAGED_CIVIC_PANEL_EXHAUSTED_CARD_CTA`,
Reach the rest another way, which the home turns into the hidden
`MANAGED_CIVIC_PANEL_EXHAUSTED_MESSAGE`; see "Reaching the rest" below). Stopped, or no enrollment: none. An open
card of another phase is deleted, so a building card set aside never hides
the ready one; words are rewritten on read; no Mark done; building and
exhausted do not lapse. The read goes through `ManagedCivicPanelService`
(by `ModuleRef`, before the lock) and a failed read leaves the card alone.
The Chief of Staff (`managedCivicPanelBlock`, `read_managed_panel`)
answers in each status's words. The priority chat reads it too
(`PriorityFlowHandler`, the `<priority>` "Civic panel" line), once when the
page opens the conversation and reused for its later turns, so a priority
never sells a text as the way to build it (no priority text asks anyone to
join; only this enrollment's invite waves do), and leads with asking a ready one
as the first round of a check, the official's pick over the round one text
or another kind of outreach; the priority page shows it under the read
(`CivicPanelStanding`), read once with the page. See the
webapp's `priorities/[priorityId]/AGENTS.md`. The civic panel page's rail shows
`ManagedPanelControls` (the Invites card): the status, the next send day
and ready week while building, Pause while building and Resume while
paused, each the `PATCH` below. The webapp never sends `stop`; the route
keeps it, and a stopped enrollment still reads and re-approves as below.

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
reconciles every unpaid send. The panel's confirmation text is the one other
free send: `claimConfirmationFree(enrollmentId)` makes the same claim on the
send linked by `Outreach.managedPanelConfirmationForId` (unique, one per
panel), but only while the panel is `ready`, only on a text that carries the
opt-out and no JOIN line, and without touching `freeTextsUsed`: it goes to
members the waves already paid to reach. `serve-citizen-panels` is the only switch:
off for the approving official, and neither the claim nor the send-time
gate lets anything of theirs go out free. Decision:
`docs/adr/2026-11-10-managed-panel-confirmation-is-a-second-free-send.md`.

The routes (`/v1/contacts/civic-panel/managed`, `ManagedCivicPanelService`,
contracts in `people/ManagedCivicPanel.schema.ts`) are gated like every
panel route: 404 with the flag off, 400 for a non-`eo-` org.

- `GET` returns `{ panel }`, null before approval. `progress` is the
  members (the standing `member` set, as the summary counts them),
  `goalMembers`, `wavesSent` (waves with `sentAt`), `nextWaveAt`: while
  building, the day the next wave goes out (`managedPanelNextWaveAt`:
  `nextManagedSendDate` from the latest sent wave's `replyWindowEndsAt`, or
  now once that has passed, at 11am Eastern so every US zone reads the same
  day), else null, and
  `firstSendDate` / `readyWeekOf` (yyyy-MM-dd, `managedPanelSchedule` in
  `utils/managedPanelSchedule.util.ts`): wave 1's own send date once it has
  one (so a wave dated under an earlier rule keeps its day), else
  `nextManagedSendDate` from the approval, and the Monday of the week two
  weeks of waves later, the same days `read_managed_panel` and the priority
  flow tell the official.
- `POST { inviteMessage, consentVersion }` approves. The invite must carry
  a JOIN line (the current `CIVIC_PANEL_JOIN_LINE`, "Reply JOIN to share
  your perspectives.", or an earlier civic panel wording a draft may
  already hold, never a citizens' panel one), no LEAVE line, and pass
  `assertServeSmsLockedLines` (the STOP opt-out, one panel line), within
  `SMS_COMPOSED_MAX_LENGTH`. It stores the approver and time, sets
  `goalMembers` to the district's `panelGoalMembers`,
  and starts `building`. That stored goal holds even if the district's
  goal later moves, and while the enrollment is not stopped the civic
  panel summary's `progress.goal` is this number, so the page, the
  Constituents section and the cards never count to a different goal
  than the one that turns the civic panel ready. Idempotent per office: an enrollment that is not
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
two days out (`MANAGED_SEND_LEAD_DAYS`), a Saturday or Sunday moved to the
Monday. That is a shorter lead than other Serve texts get, so the wave path
does not call `assertServeSmsSendDateAllowed`.

**The wave job** (`src/managedPanelWaves/`, `ManagedPanelWaveJobService`,
`managedPanelWaves` at :19 past every hour, dev and prod only, one pass per
hour under `CronLockService`). Hourly so a new approval or a closed wave
gets its next wave within the hour; it is not started from the approval
because no request may reach `claimFree`. For each `building` enrollment whose approver has
`serve-citizen-panels`, one step from what the rows say:

- An unsent wave (`sentAt` null) is sent: its send is made if it has none,
  claimed through `claimFree`, and the wave marked sent with
  `replyWindowEndsAt` `MANAGED_WAVE_REPLY_HOURS` (48) after 11am on the send
  date in the district's zone.
- A sent wave inside its window waits. A manual wave (no hand-off row) also
  waits past it until ops uploads its replies (`repliesUploadedAt`, set by
  the results upload), so the next draw is sized and steered on everyone
  who said yes. `MANAGED_WAVE_STALL_ALERT_DAYS` (2) past the window with no
  upload it posts "Civic panel wave waiting on its replies" to
  `#bot-tevyn-api`, then at most once a day (`stallAlertedAt`) until the
  upload lands; `MANAGED_WAVE_UPLOAD_WAIT_DAYS` (5) past the window it
  closes anyway, posting "Civic panel wave closed without its replies"
  first. A post Slack refuses is tried again next hour (the stall claim is
  handed back; the close waits for its post), and its error line, like a
  failed step's, pages through `serve-managed-panel-wave-failed`. Then the
  wave is closed
  (`closedAt`, and `joinedMembers`: the people its list drew who are members
  now; JOIN replies make them members through the reply ingest).
- With no open wave: members at the goal mark the panel `ready`
  (`readyAt`); otherwise `drawNextWave` draws the next and it is sent.
  `exhausted` from the draw, or a list that reaches nobody (the wave and its
  list are dropped), marks the panel `exhausted`; `out_of_free_texts`
  pauses it and posts a cap notice, as `claimFree` does for a wave over the
  cap.
- After the step loop, every `ready` enrollment with `confirmationDueAt` set
  (stamped by the step that marks it ready, so panels ready before this
  existed never get one) and no claimed confirmation gets one thank-you text
  to its members: a hidden list of the members with a cell phone
  (`createConfirmationList`, "Civic panel confirmation"), a `pending_payment`
  Serve text in the official's name (`managedPanelConfirmationText`: the
  invite's own phrases, never "civic panel"), then
  `claimConfirmationFree`. A failure logs the step-failed line and is tried
  again next run.
- After the step loop, every enrollment not stopped records each panel
  step it has reached (contracts `CIVIC_PANEL_MILESTONES` and
  `civicPanelMilestoneAt`, the same numbers the panel page draws): a
  `ManagedPanelMilestone` row, unique per enrollment and step, and one
  Civic Panel Milestone Reached event. Members who joined at the door or on
  a call count the same as by text. A stopped panel approved again keeps
  the steps it already reached. GoodParty sends the official no email of
  its own when a panel fills; marketing builds on these events.

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

**Agent-handled waves.** When the approver's `serve-panel-wave-agent` flag
is `shadow` or `auto` (no variant or any other value is off), the send step
changes: the send date is the next 11am slot in the office state's zone
(`resolveSendWindowTimeZone`, `nextAgentSendSlot`), weekends allowed, with
no `assertServeSmsSendDateAllowed`. `claimFree` carries
`{ mode, sendAt, timeZone }` on the `outreachTextSend` message, and the
sender records the `OutreachTextHandoff` row from it. The wave is marked
sent with `replyWindowEndsAt` left null until the replies arrive (below). A sent wave with a null window waits while its hand-off row
is not yet `replies_submitted`, or, with no row, while its send has not left
`pending` / `in_progress`; a manual wave
always has a window, so a null one with neither closes as before. A wave
already handed off keeps its choice: it is an agent wave if the row exists,
whatever the flag says now.

**Agent replies.** The swarm uploads its Scale to Win export to
`agent-replies/<outreachId>.csv` in the tevyn bucket. S3 emits an EventBridge
event, a rule on dev and prod turns it into a `panelRepliesUploaded` message on
the main queue, and the consumer calls `OutreachPanelRepliesService`
(`outreach/services/outreachPanelReplies.service.ts`). It acks without writing
a key that is not that shape or an outreach with no `agent` hand-off row.
Otherwise it ingests the inbound rows (`sourceLabel` `delegate_swarm_agent`),
opens the reply window (`openAgentReplyWindow`, shared with the staff results
upload below): `replyWindowEndsAt` becomes the earliest outbound row's time plus
48 hours (the wave's `sentAt` when the export has no outbound rows) with a
`replyWindowEndsAt: null` CAS, and Wave Sent (`handoff: 'agent'`) fires only
when that CAS won. It then stamps the hand-off `replies_submitted`. A reply export that
matches nobody posts once to `#bot-tevyn-api`, with the outreach id only. It
never calls `claimFree`; the wave job closes the wave once the window has
passed. A redelivery or re-upload changes nothing. Decision:
`docs/adr/2026-11-03-panel-replies-arrive-through-an-s3-event.md`.

**Results upload.** A committed (not dry-run) staff results upload for a
send with `managedPanelWaveId` stamps the wave's `repliesUploadedAt` (first
upload only; a wave nobody answered takes a file of only its outbound rows,
which any other send refuses as having no usable rows), sets its `OutreachTextHandoff` row to `replies_submitted`,
only from `queued`, and for an agent wave opens the reply window the same way
the S3 path does (from the file's earliest outbound row), so Wave Sent fires
once whichever path delivers first and the other changes nothing. It does not step the panel, because no request may reach
`claimFree`: the wave job closes the wave on its next run (an agent wave's
replies are exported after its 48-hour window, so `replies_submitted` is the
close signal; a manual wave's is `repliesUploadedAt`).

**Reaching the rest.** On the exhausted card's message, or when the
official asks, the Chief of Staff calls `read_reach_the_rest`
(`managedCivicPanel.tools.ts`, only while the enrollment is `exhausted`):
`CivicPanelReachService.optionsFor`, the first
`CIVIC_PANEL_SHORT_GROUPS_SHOWN` short groups of contracts'
`civicPanelShortGroups` (the same rows the civic panel page lists), each
with `findReachHomes` counted leaving out members and who left. A place is
offered at the door ("Knock doors in West Asheville", "around Pine St"), an
age, gender or race group on a call ("Call people 65 and over") where it
has landlines, each the other way when its own reaches nobody, and left out
when neither does. The line is "{n} seats short. {count} homes there have
no cell phone on file." or "... have a landline.". `mostlyNoCell` is true
only when most homes in the short places have no cell phone on file; only
then does the agent say the parts still short mostly have homes with no
cell phone, else "door knocking and calls can reach people a text can't".
It then calls `offer_reach_the_rest`, which the webapp draws as a
single-choice question read live from `GET /civic-panel/reach-options`;
a pick saves the list through `POST /civic-panel/reach-lists` and opens
door knocking or phone banking on it as a civic panel invite, landing on
the invite's script (`flows-civic-panel.md`, "Reaching the rest"). A failed warehouse read offers nothing.

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
- `Contacts - Civic Panel Wave Sent` (a manual wave when marked sent): `wave`,
  `texts`, `sendDate`, `steeredToward`, `handoff`.
- `Contacts - Civic Panel Wave Closed`: `wave`, `invited` (the people its list drew),
  `joinedMembers`, `membersAfter`.
- `Contacts - Civic Panel Ready` (with the status change to ready): `members`,
  `goalMembers`, `wavesSent`, `daysToReady` (calendar days from the latest
  approval).
- `Contacts - Civic Panel Milestone Reached` (once per panel per step):
  `milestone` (`first_yes`, `can_compare` at 30 members, `halfway` at half
  the goal rounded up, `full` at the goal), `members`, `goalMembers`.

The browser fires the setup steps (`EVENTS.Contacts` in the webapp's
`analyticsHelper.ts`): Civic Panel Managed Invite Value Prop Viewed and
Completed, then Civic Panel Invite Viewed, Review Viewed, Review Dismissed
and Submitted. See the
webapp's `shared/agent-chat/AGENTS.md`.

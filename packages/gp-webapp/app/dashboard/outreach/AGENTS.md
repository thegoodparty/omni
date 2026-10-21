# app/dashboard/outreach/

Voter outreach hub. Lets a campaign create text/voicemail/script/social outreach to voter audiences and tracks impact. Note: the directory is `outreach/` even though the tech design refers to it as "voter-outreach."

**Copy.** This hub's flows are the reference implementation for
`docs/product-copy.md`. Step titles are questions ("Who do you want to
reach?", "When should it go out?"), captions are one short sentence, and
shared strings live in `v2/*Purposes.ts` / `v2/channelMeta.tsx` /
`constants.tsx`. Read that file before adding or editing any string here, and
reuse an existing phrase over inventing a new one.

**`v2/` is mounted by Serve too, so every string here has two readers.** An
elected official has constituents, an office and a term — no voters, election,
candidate or ballot, and no "campaign" in the run-for-office sense (an
outreach campaign is fine). Add a Serve-framed string by giving the component
a mode-keyed copy object, never by renaming the Win one: Win copy must not
change. `SERVE_PHONE_BANKING_AUDIENCE_COPY` in
`v2/phone-banking/PhoneBankingFlow.tsx` is the shape. Full rule, the banned
list, and the check that enforces it: **`docs/product-vocabulary.md`**.

## The outreach hub

`page.tsx` (server component, fetches rows + compliance) renders
`v2/OutreachHubPage.tsx` directly — the hub (`v2/`) is the unconditional
outreach page for every candidate, and every tile opens its own new flow:
`SocialFlow`, `PhoneBankingFlow`, `RobocallFlow`, `SmsFlow` (all with
upgrade-at-entry), and door knocking navigates. There are no tile-swap flags.
The text gate (Pro/compliance) runs in front of the SMS tile.

**Every way into a text/robocall campaign now lands on the v2 flows, and the
hub is the only page that mounts them** (a chat card's proposal mounts one
over the conversation, below). A campaign-plan task CTA (campaign
tracker, campaign manager) and Know Your Opponent's suggested message all link
to `/dashboard/outreach?compose=text|robocall`, and
`components/OutreachComposeDeepLink.tsx` resolves those params, runs the
channel's gate, and hands the hub a `ComposeRequest` — it mounts no flow of
its own.

Linking beats mounting in place because the hub owns exactly one instance of
each channel flow plus the gate in front of it; a second mount would duplicate
both. `util/composeOutreachHref.util.ts` builds the URL, and the press site
rides it as `?source=` (allowlisted, so the query string cannot inject an
arbitrary value into `ClickCreate`) — without that every task CTA would report
as a plain `deep_link`.

Three seeds ride the deep link into the flow: `campaignPlanDueDate` (a task's
due date, persisted on the outreach record and forwarded into the CAS Slack
notification — for robocall this is on the `POST /v1/outreach/robocall` draft
contract), `initialScript` (text and phone banking; opens the flow on the
`custom` purpose, the one that never AI-drafts, so a preset message is not
immediately drafted over), and `preselectedListId` (applied once its row
arrives in the picker; an id naming no list of yours is a missed preselection,
never a broken step). A chat card's proposal mounts the flows itself
(`shared/agent-chat/cards/proposalFlows.tsx`): the Serve surfaces for Chief
of Staff, and Win's own flows for a Campaign Manager card: `SmsFlow` behind
the same text gate the SMS tile runs, `PhoneBankingFlow` and `SocialFlow`
on their default surfaces. That Win text create carries the card's
`proposalKey` on `POST /v1/outreach` (never beside `draftOutreachId`), so
the card reads as sent once the text is paid for; the Win phone banking
and social creates take the key alone, never a Serve link's priority. It adds two seeds: phone
banking's `initialName`, and `proposedAudience` on phone banking and SMS, an
audience the agent counted but did not save. For text and phone banking, on
Win and Serve, the provider saves that audience itself and passes
`preselectedListId` instead, so both open the standard flow on the message
with the purpose and the list done behind it: every step in the stepper,
Back to the list (picked in the picker) and then the purpose, Continue
onward as usual. Where a flow opens is `v2/landingStep.ts`'s
`outreachLandingStep`: the message when the audience is settled and so is
the message, written or to be drafted for a settled purpose (a civic panel
plan step: purpose and frozen list, the draft generating on arrival); the
audience step when only the message (or the purpose) is; otherwise the
purpose. An event invite with no message still asks its details first. A
card's message is always there, so a card whose
audience saved lands on the message, and one with no audience to save lands
on the picker with its message held for compose. `SmsFlow` takes
`audienceSettled` (the caller saved and picked the list) and otherwise runs
its one order, purpose → audience → compose → schedule → review, the same
as every other entry. A deep link's `?listId=` is not settled: the id is
unverified until the picker matches it, so it lands on the audience step.
On Win a flow that lands on the message derives the Peerly phone list for
the card's list once per open, as the audience step's Continue would have;
a failure goes back to the audience step, where the error and its retry
live. `PhoneBankingFlow` asks the same function twice: on open (no list is
resolved yet, so the who step at most) and once a preselected list matches
a picker row, when a handed-over script, or an `initialPurpose` with no
script (not an event invite), moves it on to the script. `proposedAudience` (still accepted by both flows) opens the
audience step
in the builder already filled in (`useOutreachAudience`'s reset seeds it), so
the list is saved where the flow always saves one: when the official confirms
and names it. A proposal that asks a sample (`sampleSize` under its `count`)
carries `proposedAudience.sample`, and the save posts it as the list's
`sample` along with the count overlay, so the list is the frozen draw of
people this channel can reach rather than the live filter; the builder's
count, and so "Continue (N)", reads the sample's size. A reset clears it with
the other builder fields. A priority's text that asks the civic panel
opens the Serve `SmsFlow` with the JOIN ask ticked
(`initialAsksToJoinCivicPanel`), which the official can still untick.

A priority text's follow-up (`roundOneOutreachId` set) reads **Draft** in the
history until its recipients are picked and **Scheduled** after, never In
review (`historyStatus.util.ts`, off its list's `sampledAt`), and its drawer
says "Recipients picked <date>, from the groups you've heard least from". One
canceled because its draw found nobody says "Nobody left to text, so this was
canceled. We'll refund it."

`SmsFlow` also takes `initialPurpose`, which opens past the purpose picker on
that purpose the way a carried recommendation does; the Serve hub passes it
for its `?compose=text&purpose=build_citizens_panel` link
(`constituent-outreach/AGENTS.md`), and a chat proposal card for its
`purpose` (the Chief of Staff's panel invite). With `initialScript` too, the
seeded words are kept on that purpose rather than opening on `custom`. On Serve, `build_citizens_panel` is
offered only behind `serve-citizen-panels`, and picking it ticks the compose
step's "Ask them to join your civic panel" and disables the box
(`civicPanelAsk.locked`): a panel text is its ask, so every message it
composes carries the JOIN line, and Continue holds while the line is
missing. Serve phone banking and door
knocking carry the same slug as "Invite to your civic panel"
(`servePhoneBankingPurposes.ts`, `serveDoorKnockingPurposes.ts`), offered
behind the same flag; its script or talking points are a short invite whose
ask is the join question the caller or canvasser records.

A Serve text whose picked list is civic panel members only (contracts'
`isCivicPanelOnlyList` on the list's criteria, behind `serve-citizen-panels`)
carries `CIVIC_PANEL_LEAVE_LINE` ("Reply LEAVE to leave my civic panel.") in
the JOIN line's place: appended above the opt-out and required the same
way (`withCivicPanelLeave` / `withCivicPanelLines` in `smsCompose.util.ts`), and
the "Ask them to join" box is not shown. A message never carries both; when
the list settles or changes under a composed message (a card's preselected
list resolving, or going back for another list) the flow swaps the line to
match. That swap follows the list, never an edit, so a line the official
deletes stays deleted until they add it back. A chat card that asked to join
on a panel-only list therefore opens with LEAVE.

Every rewrite (fresh draft, Improve, a tone pill, a carried-in body, the list
swap) ends in `withCivicPanelLines`, which strips every JOIN or LEAVE wording
it finds (all of contracts' `CIVIC_PANEL_JOIN_LINES`, plus a model's partial
echo of the ask) and puts back exactly one line above the opt-out; a body the
model wrote also loses any exact opt-out or "Paid for by" copy before it is
composed. An Improve reply is restored against the surface's footer alone
(`keepSystemRegions`), never the panel-line message: taking the JOIN line for
the footer once sent the ask twice and dropped STOP. gp-api refuses a Serve
create with no opt-out or a second panel line, so a composer bug cannot reach
a send.

A compliance error on the compose step says what is missing and shows the
exact line to restore (`standardsFailureCopy` in `SmsComposeStep.tsx`), with an
"Add it back" button for the opt-out, greeting, name and disclaimer that puts
the line back where the flow writes it (`addOptOutBack` and siblings in
`smsCompose.util.ts`).

`report_back` is never in the picker: its audience is one earlier send, which
only a priority's report back card names. That card opens the Serve `SmsFlow`
with `initialPurpose: 'report_back'`, its message seeded (the purpose is kept
rather than turned into `custom`), `reportBackForOutreachId` riding on the
create, and the proposed list's `sample.recipientsOfOutreachId` set, so the
list saved is that send's people, frozen. The JOIN ask is off and its box is
not shown, whatever the card said.

The voter data page's "Choose a channel" picker (`contacts/crm/shared/channelPicker/`)
links here with the flow named — `?compose=text|robocall|phoneBanking|social&source=voter_data`
— and the audience beside it as `?listId=` (a saved list) or `?recommended=<variant>`
(a recommended list not saved yet — `docs/features/recommended-lists.md`). The
deep link opens that flow on arrival with the audience seeded, exactly as a
task CTA does; phone banking's non-Pro path is the tile's upgrade-at-entry
redirect, social has no gate. A bare `?listId=`/`?recommended=` with no
compose still lands on the tile grid. Both are read server-side in `page.tsx`
(`util/parsePositiveListId.util.ts` / `util/parseRecommendedListVariant.util.ts`,
anything unknown ignored) and handed to `ChannelTileGrid` as the carried
audience (`v2/audiencePreselect.ts`'s `AudiencePreselect`). Every
audience-taking tile spends it on open — SMS, robocall and phone banking
through their open callbacks (the hub holds it as `tilePreselect` until the
flow closes), door knocking in the URL it navigates to — so whichever channel
the candidate picks receives what they arrived with. A recommendation is
fetched by the flow for its own channel (`preselectedRecommendedVariant` →
`useOutreachAudience`) and answers the purpose step on its own: every variant
belongs to one intent (the contracts' `RECOMMENDED_LIST_VARIANT_INTENT`, which
gp-api's registry test asserts it agrees with), and
`audience/recommendedListMapping.util.ts`'s `purposeForRecommendedVariant`
inverts `intentForOutreachPurpose` to name the purpose, so each flow's
fresh-open reset lands on the audience step with that purpose set — phone
banking drafts its script for it there, as a tap on the card would — and the
recommendation arrives as the selected card (see the audience step row below).
The list is created when the candidate presses Continue.

Phone banking's upgrade-at-entry: a non-Pro click on the tile redirects
straight to `/dashboard/pro-upgrade` (firing
`EVENTS.ProUpgrade.Compliance.LockedItemClicked`) instead of a legacy Pro
modal. The predicate is `ChannelTileGrid`'s own `canUseProFeatures`
(`!!campaign?.isPro || !!electedOffice`, not imported from
`ContactsTableProvider` — that hook is contacts-scoped) and a pending
`useElectedOffice()` query is never read as a refusal.

## v2/ — the Voter Outreach 2.0 hub (phases 1-2 + 3-4 slices)

Moved to [`../../../docs/outreach-v2-hub.md`](../../../docs/outreach-v2-hub.md) (~199 KB). Grep it for the file, class, or route you are working on; do not read it whole.

## SMS compliance cutoff

gp-api decides when texting is too late for a race and returns
`smsCompliance` (`open` | `closing` | `closed` | `not_applicable`) with
`smsCutoffDate` on the campaign; the webapp reads it through
`shared/smsCutoff/useSmsCompliance` and never does date math (missing means
`open`). `closed` is authoritative over any TCR status.

The cutoff is shown only in context, mostly as a hover reason, never
announced. Every closed reason is `SMS_CUTOFF_COPY.closedReason` ("The
{Oct. 15} deadline to get verified for texting has passed.").

- **Membership and gate.** `deriveMembershipState` returns `texting: 'closed'`,
  so `useOutreachGate('sms')` returns `'closed'` AHEAD of `'pro'`: Pro cannot
  reopen texting, so a free candidate gets the notice, not a pitch for a text
  that could never send. Other channels are untouched.
- **SmsFlow** renders the notice (`SmsCutoffNotice`, surface `sms_flow`,
  titled with the closed reason) in place of the whole flow, before build
  mode, a resumed draft or the gate, and `useDraftGate` never opens the gate
  for `closed`. `OutreachGate` has a `closed` screen (surface
  `outreach_gate`) for an upgrade whose Continue finds the window closed.
- **The text tile is a dead end with a reason.** On both sides of the flag,
  `ChannelTileGrid` renders the closed text tile greyed ("Not available for
  this race") with the closed reason in a styleguide `Tooltip` (hover, and
  tap through `openOnClick`); a click opens nothing and fires nothing. While
  `closing` it carries `SMS_CUTOFF_COPY.countdownChip` ("Verify to send SMS
  by {cutoff}").
- **Deep links are the fallback.** `OutreachComposeDeepLink` opens
  `SmsCutoffNoticeDialog` (surface `compose_deep_link`) for `?compose=text`,
  which covers every link that opens a new text, and never fires
  `ClickCreate` for it. With the tile and the drawer CTA both inert, a deep
  link or a resumed draft is the only way to reach the notice.
- **History.** A texting draft reads "Texting closed" (ahead of the tier)
  with the closed reason on hover (`HistoryStatusText`'s
  `textingClosedReason`), and its drawer footer is a disabled "Texting
  closed" beside Delete, wrapped in a focusable span so the same tooltip
  opens over a disabled button.
- **Voter data channel picker.** `ChannelPickerSheet` drops SMS below social,
  renders it as a disabled row (no link), and shows the closed reason as a
  tooltip on hover and as the row's subtitle on a coarse pointer.
- **Pro pitches stop selling texting.** `ProPitchPanel` swaps the sms
  value card for `gateCopy.ts`'s `PRO_COPY_SMS_CLOSED` (voter data,
  robocalls, phone banking, door knocking) and drops the verification card.
  Before purchase (the value card is showing) it adds one small info `Alert`
  with the closed reason, for every channel. `shared/P2PUpgradeModal`
  (every line sells texting) never opens once closed, and
  `shared/ProUpgradeModal` swaps its texting lines for voicemail and
  door-knocking ones.
- **Analytics.** The notice fires `Outreach - SMS Cutoff Notice Viewed` /
  `Completed` itself, with `surface`; a host fires nothing. Its robocall,
  phone banking and social links reopen this hub with `?compose=`, so a host
  on the hub passes `onPick` to close itself first.

## Gate (milestone 2)

Moved to [`../../../docs/outreach-gate.md`](../../../docs/outreach-gate.md) (~12 KB). Grep it for the file, class, or route you are working on; do not read it whole.

## Shared support files

Moved to [`../../../docs/outreach-shared-support-files.md`](../../../docs/outreach-shared-support-files.md) (~14 KB). Grep it for the file, class, or route you are working on; do not read it whole.

## Analytics

**One outreach event for every channel, carrying `medium` + `fanout` — never
one event per channel.** The three per-channel `Outreach - <channel>: Complete`
events went dark one at a time when this hub replaced the surfaces that fired
them, and nothing noticed for a month. `Outreach - Campaign Completed`
now fires from every flow (`SmsFlow` on payment settling, `RobocallFlow` on the
hold settling, `SocialFlow` on Save, phone banking when the last entry in a
list is called), and `Outreach - Campaign Created` fires on every channel
before it, so created → completed is one funnel with no channel-shaped hole.

**Win and Serve are the `product` property, not a second event name.** One
`Outreach -` namespace for both, and `outreachProduct(isServe)` derives the
cut. `isServe` is REQUIRED on `OutreachEventInput`, so a shared surface that
forgets it fails the typecheck rather than reporting every Serve campaign as
Win. A two-name split would make every cross-product total a union, which is
the shape that let the per-channel Complete events go dark one at a time.

`util/outreachAnalytics.ts` is the one place the payload is shaped, and its
omission rules are the whole point: `recipientCount` is omitted on social (a
post has no recipient count), `price` is omitted on a free channel, a tracker
origin travels as both halves or neither, and `campaignName` is absent on the
manual-log paths that name nothing. `voterContacts` mirrors `recipientCount`
under the retired Complete events' name so their charts survive the cutover —
build on `recipientCount`. Never hand-build these props: a 0 where a property
should be absent reads as a real measurement.

**Every channel flow knows where it was opened from.** The hub, and the door
knocking page for its create flow, hand each flow an `OutreachFlowSource`
(`util/outreachAnalytics.ts`). `OutreachFlowShell` puts it on the stage
events beside `locked`, which means "this attempt started behind the Pro
wall": `v2/gate/useLockedAtOpen.ts` freezes it once per open, after the gate's
`resolved` says membership has loaded, and the shell holds stage events while
it is still null. Each flow's `OutreachGate` passes it, with the
label of the button that opened the gate, into `Pro Upgrade - Flow Started`.
Every flow takes `source` as a required prop, so a new mount cannot forget
it. A gate opened from a new button has to record that button's label, the
way `useDraftGate.saveDraft(cta)` does.

`medium` uses the campaign tracker's `TaskChannel` vocabulary, not
`OutreachType`; `outreachChannel()` is the whole cross-walk, and it exists
because the two disagree in four places (`p2p`, `nativeDoorKnocking`,
`nativePhoneBanking`, `events`). Full schema, the fan-out rule and the
migration: **`docs/features/voter-outreach-analytics.md`**.

## Patterns

- **Context-driven**: `OutreachContext` holds the outreach rows. Components read from context rather than threading props through action menus.
- **Audience downloads** go through `helpers/createOutreach.ts` and `helpers/createP2pPhoneList.ts` — don't reinvent the file shape.

## Draft-first purchase flow (text/p2p)

The paid text flow persists the campaign BEFORE payment: entering the review
step in `v2/sms/SmsFlow.tsx` creates the outreach with
`draft: true` (server stores it as `pending_payment`, hidden from
`GET /outreach`), and the draft's id rides in the checkout session metadata as
`outreachId`. The SERVER finalizes (Peerly + CAS Slack) during payment
completion — the client no longer POSTs the campaign after paying, it just
refetches the list. A tab that dies after payment loses nothing: the Stripe
webhook finalizes the draft on its own. Going back from the review step
discards the draft id; re-entry creates a fresh draft (stale ones stay hidden
server-side) — EXCEPT on a milestone-2 resume, where review converted the
candidate's saved `draft` row in place (`draftOutreachId`) and discarding its
id would send the re-entry into a 409. Robocall runs the same shape through its own contract
(`POST /v1/outreach/robocall` + the pay step's authorization hold).

The pay step's Stripe session comes from `CheckoutSessionProvider`
(`app/dashboard/purchase/components/`). When gp-api refuses to create it, the
provider shows the 4xx `message` as-is (Stripe's own validation text
included); a 5xx or a non-JSON edge response keeps the generic "Failed to
create checkout session", and every report to Sentry carries the HTTP status.
It used to read a `data.error` field gp-api never sends, so every refusal
reached the candidate and Sentry as that one generic line (2026-10-06).

## Gotchas

### Shared

- Status labels in `constants.tsx` are mirrored on gp-api — keep them in sync if either side changes.
- **`OutreachType` is hand-rolled in four places** (`gpApi/types/outreach.types.ts`, `hooks/OutreachContext.tsx`, `constants.tsx`'s `OutreachTypeKey`/`OUTREACH_TYPES`, and `util/getEffectiveOutreachType.ts`'s `VALID_OUTREACH_TYPES`) instead of importing the contracts `OutreachType` enum. Consolidating onto the contracts enum is a real cleanup, deliberately deferred rather than folded into a feature ticket — file it separately if you're touching this area again.
- **`nativeDoorKnocking` is in three of those four, and its absence from the fourth is deliberate.** `VALID_OUTREACH_TYPES` is named like a type registry but is really the allowlist of types a **task** may open a create-flow for, and the knock transaction is the only writer of a `nativeDoorKnocking` envelope — `createOutreachSchema` rejects the type from clients outright. Adding it there would let `TasksList` open a flow modal for a channel that has no create flow. Don't "fix" the inconsistency without renaming the constant to match what it actually gates.
- **Card copy and default campaign names are two records per channel, and the custom purpose is excluded from the second one.** A purpose card's label answers "what do you want to do"; a name suggestion is the title the campaign carries in outreach history forever. Sharing one record means the next copy correction silently renames campaigns (#1385), and it means "Write my own message" / "Write my own script" — a purpose with no subject to name — becomes a campaign name verbatim. The audit as of #1385 plus this change: **social, phone banking, Serve social, and Serve phone banking** auto-fill from the purpose, so each reads its own `*_PURPOSE_NAME_SUGGESTIONS` (`SOCIAL_PURPOSE_NAME_SUGGESTIONS` / `PHONE_BANKING_PURPOSE_NAME_SUGGESTIONS` / `SERVE_SOCIAL_PURPOSE_NAME_SUGGESTIONS` / `SERVE_PHONE_BANKING_PURPOSE_NAME_SUGGESTIONS`) and all four flows skip the fill for `custom`, leaving the field empty and the CTA disabled until the candidate types one. **Robocall is not affected and needs no guard**: `goToSchedule` names the campaign off the selected _list_ (`"<list> robocall"`), never the purpose, so `ROBOCALL_PURPOSE_LABELS` only ever feeds cards. A channel (or surface) that starts naming campaigns off its purpose has to add its own suggestions record; `socialPurposes.test.ts` / `phoneBankingPurposes.test.ts` / `serveSocialPurposes.test.ts` / `servePhoneBankingPurposes.test.ts` / `serveSmsPurposes.test.ts` each assert no purpose shares a string across the two records, which is what keeps them from collapsing back into one. **SMS is the partial case**: its auto-name is list-and-date driven (`"<list> — SMS, Sep 4"`), so the purpose only ever supplies the fallback used before a list is picked — `SERVE_SMS_PURPOSE_NAME_SUGGESTIONS` on Serve, the flat `'Text campaign'` on Win. `custom` therefore does not leave the field empty here; it falls back to that same neutral string, which is why the record keeps a `custom` entry rather than omitting it.
- **A missing `CHANNEL_META` key degrades silently, and `getChannelLabel` is why.** It falls back to capitalizing the raw type, so an unmapped channel renders as a plausible-looking `NativeDoorKnocking` in a grey badge rather than throwing. `CHANNEL_META` is typed `Record<OutreachType, ChannelMeta>`, so widening the union is what forces the entry to exist — keep that typing.

### Door knocking in the outreach surfaces

- **The shared list details drawer lives in `v2/listDetails/`, and the outreach drawer is its reference caller.** `ListDetailsSheetShell` (container, 608px content column, close inside that column, header/body/footer split), `ListDetailsMetric` (Overview cell, the two-column grid, the labelled filter-pill group, the section overline) and `ListDetailsFooter` (the action row) were lifted out of `OutreachDetailsDrawer` so `door-knocking/native/TurfDetailsSheet.tsx` could land on the same anatomy. They stay here rather than moving somewhere neutral because this drawer is the one the canvas draws and the one every channel already opens; door knocking is the surface that joined it. **What each caller keeps is the body**, since the two answer about different objects — an envelope read from `GET /v1/outreach/:id`, or a saved list whose figures come from the voter pack and a frozen route. That is why `Metric` carries `pending` and `progress` that only door knocking passes: the shared cell is the union of what the two needed, not the intersection. The shell's `DrawerTitle` renders `asChild` as a `span`, because every caller's `header` already carries the visible `h2` with the same words and two headings reading the same campaign name is one more than the sheet has sections to head.
- **The footer is a closed set of four modes (`v2/listDetails/footerMode.ts`), keyed on lifecycle × "can this candidate do anything about it from here".** Lifecycle comes from the **displayed status label**, not from `status`, so the footer can never contradict the badge two inches above it — a p2p row with a live Peerly job reads "Done" while its spine status is still `paid`. Self-serve is the two channels we run ourselves. The consequences worth knowing: a scheduled **paid** campaign gets `automatic` ("This campaign is sending automatically. No action needed.") rather than the canvas's `edit`, because Peerly sends it and there is no edit or delete endpoint anywhere to put behind those two buttons — `edit` lands in the door-knocking drawer instead, on an unknocked list, which really does have both. `in_progress` + self-serve is `continue`, which is where phone banking's "Continue calling" sits; the labels are one map (`CONTINUE_LABELS`) in `footerMode.ts` so a second drivable channel cannot invent a second verb. **Door knocking takes no primary from this footer at all now.** A campaign is several turfs, each listed in the drawer with its own knock CTA, so one bottom button would have to pick a turf for the candidate — the next-unfinished-turf plumbing that used to do that is gone with it. Its `continue` footer carries only Mark campaign done, which is the one act that is about the campaign rather than about a turf. `CONTINUE_LABELS.doorKnocking` is still the source of the per-turf label, read by `CampaignTurfList`. **A list nobody has worked yet reads a different verb (ENG-11066/ENG-11070)**: `footerMode.ts`'s `continueLabel(channel, progressCount)` reads `ZERO_PROGRESS_LABELS` ("Call this list" / "Walk this route") instead of `CONTINUE_LABELS` when the channel's own progress count (`phoneBanking.peopleCalled` / `doorKnocking.loggedCount`) is `0` — the same rule `app/volunteer/components/AssignmentCard.tsx`'s `resolveAction` already shipped for the volunteer assignments page (PR #1742); this drawer's loading-state placeholder (the href isn't known yet) keeps the plain `CONTINUE_LABELS` copy, since progress isn't known either at that point. Draft, In review, Denied and Pending payment have no canvas position, so they get no primary — inventing one for them is exactly the fifth mode the closed set exists to prevent, and `ListDetailsFooter` now DROPS the whole canvas row in `none` so a caller that passes a primary has it ignored rather than rendered. A milestone-2 `draft` row never reaches this footer at all: the drawer renders its own node (`draftFooterAction`, above) with Delete beside the step still in the way, so neither the canvas row nor the shelf below applies to it. **In review and Denied do get the shelf.** `none` used to return null unconditionally, which meant a row reading In review had no control on any surface able to move it: the legacy `POST /outreach` path writes `pending`, which non-p2p rows render as "In review", so every pre-VO-2.0 request that was never fulfilled sat in history permanently. That is the opposite of what "history is never hard-deleted" is for, so the secondary slot answers for those states. Archive is ours rather than the canvas's, which is what lets it speak where the primary cannot. **Archive is not a cancel**: `OutreachService.setArchived` writes `archivedAt` and nothing else, so archiving a p2p row that is booked with canvassers takes it off the candidate's list without stopping the send — cancelling a booked send is the CAS console's job. **`done`'s canvas primary ("Show results" / "Show post") was deliberately not landed**: phone banking's results are in this drawer's own body, `OutreachSocialAsset` carries no post URL (which is why the canvas itself draws that button disabled), and no other channel has a results surface — a permanently disabled button is not a design to port.
- **The door-knocking tile hands its audience over in the URL, and stops there deliberately.** Every other tile opens a flow in place and passes the carried audience as props; door knocking navigates, so it travels as `?listId=` or `?recommended=` — the same params the voter data page's "Send outreach" links use to reach this hub, parsed on the far side by the same `util/parsePositiveListId.util.ts` / `util/parseRecommendedListVariant.util.ts`. A recommended variant is fetched on the far side for door knocking (so it arrives with its precinct cut), held in `CreateListFlow`'s own state the moment it lands (the page spends the param on apply, which drops the prop and its query, and the card has to stay on screen after that), and applied through the same `applyRecommendation` a card tap uses (the who step then paints that card pressed, `WhoStep`'s `activeRecommendationVariant`) — one that names a saved list waits for the picker's rows first, exactly as the `?listId=` arrival does, because applying before the row is there builds the list a second time instead of selecting it. The far end is `door-knocking/native/createFlow/CreateListFlow.tsx`, which matches the id against the who step's own picker rows before applying it, so a deleted, archived, foreign or invented id is a missed preselection and never a broken step. **The param is deliberately not stripped from the address bar** the way `OutreachComposeDeepLink` strips this hub's: there the deep link opens a flow on mount and the id is spent immediately, whereas the door-knocking create flow opens whenever the candidate presses Create list, so stripping on arrival would throw the list away before anything could read it. Because it stays, the arrival is spent **in state instead of in the URL**: `CreateListFlow` raises `onPreselectApplied` the moment it applies the id, and `NativeDoorKnockingPage` records it as spent above the flow's mount boundary — the flow is unmounted on every close, so its own ref cannot remember, and without this a dismissed list would snap back on each reopen. It is recorded as the spent **id**, not a boolean, so pressing the tile again with a different list still preselects. **And arriving with a list does NOT auto-open the create flow** — that is a separate deferred decision with a named precondition (`/v1/door-knocking/pack` latency and reliability), argued in `door-knocking/VOTER-OUTREACH-2.0-AUDIT.md`; a deep link that auto-opened would land in exactly the false "No matching households" state that deferral exists to avoid. Don't wire it here without re-reading that section.
- **A `nativeDoorKnocking` row's figures ride `OutreachDetail.doorKnocking`.** The block carries the turf id, the route id, the turf's live name, doors / knockable people / logged, and the turf's `completedAt` + `archivedAt`. gp-api fills it by hopping the envelope's `doorKnockingRouteId` to `door_knocking_route.doorKnockingTurfId` (`@unique`, so route → turf is one hop and no column was added), and its counts come from the SAME `DoorKnockingTurfCountsService` aggregate the door-knocking rail reads. **Do not compute a door, people or logged figure here** — a second derivation of a number already printed on the rail risks two different numbers for one quantity, and the rule is one quantity, one number. A walk whose saved list has been tombstoned gets no block at all: the envelope and its paid route survive a soft delete, the list does not, so the drawer says so rather than rendering cells that can only read "—". See `packages/gp-api/docs/door-knocking.md`.
- **Those figures are the ANCHOR turf's, never the campaign's, so every surface that prints them guards on `turfCount === 1`.** A door-knocking campaign is many turfs under one Outreach anchor, and the history list collapses the siblings into that anchor (`collapseDoorKnockingCampaigns`, which attaches `turfCount`). `OutreachDetail.doorKnocking` is still read off the anchor's own route, so on a collapsed row its doors / people / logged describe ONE turf while the row is named after the whole campaign. There is no campaign-level rollup yet, so the answer everywhere is to withhold the number rather than print a wrong one: three call sites do it — `OutreachDetailsDrawer`'s progress bar and `OutreachHistoryTable`'s `RowMetric` and `RowResults`, which show a dash (already that function's answer for a row with nothing to report). **The Overview cells were the fourth and the section is gone**: its Date, Name and Channel were the header two inches above, and the Doors/People pair beside them was the anchor's, withheld on every multi-turf campaign anyway. The table's two were missed when the collapse landed and printed one turf's figures under the campaign's name until #1950 caught it. Per-turf figures live on the drawer's sibling list, which reads `GET /v1/door-knocking/campaigns/:anchorId`. **If a rollup is ever added, these three are the readers to revisit together** — a fourth surface that forgets the guard fails silently and plausibly, which is how the table's two did. **`status` and `archivedAt` are NOT among the four**: both are rolled up inside `collapseDoorKnockingCampaigns` (done only when every turf is, on the shelf only when every turf is), so no surface guards them and none should start. A correction every reader needs belongs in the collapse; a figure only some readers can print is what the guards are for. The footer's "Continue knocking" no longer reads the anchor either — it opens the first UNFINISHED sibling off the campaign turfs query, because a campaign whose anchor is finished still reads In progress and that link used to open a route with nothing left to knock.
- **A campaign has its own lifecycle writes, and the per-turf routes stayed per-turf.** `POST /v1/door-knocking/campaigns/:anchorId/complete` and `.../archive` write every sibling envelope in one guarded `updateMany`, and the drawer's footer calls them: "Mark campaign done" while the campaign reads In progress, Archive/Restore once it reads Done. **`canArchiveFromDrawer` is gone** — the `turfCount === 1` guard that used to withhold both archive buttons, whose own comment called its removal the definition of done. What replaced it is `campaignTurfs.length > 0`, which also covers the tombstoned-list case the old `Boolean(doorKnocking)` gate covered and improves on it: a campaign whose anchor turf was deleted but whose siblings live can now be archived. **Do not "fix" anything here by fanning the TURF routes out**: `POST turfs/:id/archive` and `.../complete` are the walk's own footer and its `finishAndArchive`, so a fan-out there shelves a whole campaign when a canvasser finishes one turf of it, and completion has no undo anywhere in this product. That is why the campaign got its own pair rather than a `scope` flag. The `turfCount === 1` guards on the progress bar and the table's two metric cells are untouched and still wait on a server-side rollup of doors, people and logged — deleting `canArchiveFromDrawer` does not license deleting those.
- **The archive seam: door knocking owns the write, and this drawer goes through it.** There is no longer a pair of flags to keep in step — `DoorKnockingTurf` has no `archivedAt` at all, and the `Outreach` envelope's is the whole lifecycle — but the routing rule survives the mirror that motivated it. Archive/Restore here calls `POST /v1/door-knocking/campaigns/:anchorId/archive`, never `PATCH /v1/outreach/:id/archive`: the door-knocking routes are the ones carrying the turf scope and the idempotence guards (one shared timestamp across siblings, a repeat press moving nothing), and the generic envelope route has none of them and no outreach-type guard either. The archived STATE is still read off `doorKnocking.archivedAt` rather than `row.archivedAt`, because the block arrives with the detail and a row opened by deep link has no cached copy to be right about. `useTurfLifecycle` remains the walk's caller of the per-turf route, and `campaignLifecycle.ts` is this drawer's caller of the campaign one.
- **The `done` footer's primary slot is empty because nothing can go in it — audited, not overlooked.** `done` itself renders: Delete on phone banking, Archive/Restore, and door knocking's archive note. What is missing is only the canvas's CTA. **"Show results" has no destination:** no route renders campaign results, and the sole outcomes view is a section in this drawer's own body (`nativePhoneBanking`'s "Results", off `OutreachDetail.phoneBanking`) — so on the one channel that has results, the button would point at itself. Door knocking is not an exception: `TurfDetailsSheet` shows doors/people/logged, which is progress, not outcomes. Text and p2p do store per-recipient `respondedAt`/`optedOutAt` (`ContactInteractionText`, swept hourly), but nothing aggregates them and the sweep documents its own Peerly ingestion as unverified — validate that feed before publishing a rate off it. Robocall materializes recipients and captures no outcome at all: `answeredAt`/`voicemailLeftAt` are written only by the manual per-person log, which sets `outreachId: null`. **That one is not a sweep we forgot to wire, it is a phase that does not exist:** no robocall vendor is integrated — CallHub is named only in prose, Peerly's reports are its SMS product, and the channel has no send step — so a robocall "Show results" is blocked behind a vendor decision, not behind UI work. **"Show post" cannot be backed at all** — `OutreachSocialAsset` is generated copy, there is no publish step anywhere in the product, and no URL is recorded on the asset, in a webhook or in an audit row. If results ship, they belong in the body beside Overview the way phone banking's do, not behind this slot. Do not add a disabled button here.

## Related

- `packages/gp-api/src/outreach/AGENTS.md` — the backend module: the social endpoints and their campaign-materials grounding, draft-first purchase finalization, and the Peerly seams.
- `helpers/createOutreach.ts`, `helpers/createP2pPhoneList.ts`.
- `gpApi/outreach.api.ts` + `gpApi/types/outreach.types.ts` — shared shapes; the social endpoints live in `gpApi/api-endpoints.ts` with contracts from `@goodparty_org/contracts`.

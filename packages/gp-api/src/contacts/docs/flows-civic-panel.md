# Flows: follow-up flag and civic panel

<!-- Moved verbatim from contacts/AGENTS.md so the auto-loaded AGENTS.md stays small. Edit here. -->

### Serve's follow-up flag

`ContactStatusField.follow_up` is the layered status model's fifth field and
the only one Serve writes. It is deliberately not a column on the interaction
tables: `contact_interaction_phone_banking.follow_up` and
`contact_interaction_door_knock.follow_up` answer "did this ONE call or knock
end owing this person something", which is immutable history, while this field
answers "is anything still owed", which an official toggles as they work
through people. Vocabulary is `FollowUpStatus { requested, cleared }`, with
`cleared` a real value rather than a deleted row so a reversal is recorded,
same as `do_not_knock` —
"who followed up, and when" is the question the feature exists to answer.

Three writers, all through `ContactStatusService.changeStatus`:
`ContactsService.updateFollowUp` (`source: manual`, `actorUserId` from
`@ReqUser()`, no Pro gate — an `eo-` org clears `hasElectedOfficeAccess`
outright), `PhoneBankingCallService.emitFollowUpEvents`
(`source: phone_banking`, `sourceId` minted per save from
`(interactionId, updatedAt)` so a corrected answer records a new event), and
`ContactInteractionDoorKnockService.emitFollowUpEvent` (`source: door_knock`,
`sourceId` stable per synced knock so a replay no-ops, same accepted
correction limitation as the `willVote` twin above). Each carries the inverse
of the likelihood writers' guard — `startsWith('eo-')` must be true — and
`fallbackFromValue: FollowUpStatus.cleared`, since nothing derives this field
and nobody is born flagged.

**Latest answer wins**, including a caller's "no" clearing a flag set by hand
on the contact card. Only-ever-raising was rejected: the flag's job is to say
what is STILL owed, and a flag that only accumulates is one nobody trusts. The
clear is its own event with its own actor.

**No backfill** from the follow-up answers already on interaction rows —
replaying history would raise flags on people whose request may long since
have been met, and an official cannot tell a stale flag from a live one.

**The audience side.** `voter_file_filter.follow_up_requested` is the saved-
filter dimension that turns the flag into people you can act on. It is not a
voter-file column: it resolves through
`ContactStatusService.personIdsByFieldValue(follow_up, [requested])` into an
`id: { in }` constraint, AND-composed via `intersectIdFilterResolutions` the
same way `contactsMade` is, and it sits in `fieldsHandledSeparately` so the
generic loop never tries to map it. Serve-only and the exact mirror of
`contactsMade`: `resolveIdFilterWithContactsMade` takes one branch or the
other, and `assertNoFollowUpFilterForCampaign` 400s a Win org rather than
ignoring the key, because a silently-dropped dimension returns a WIDER
audience than asked for and a phone list built from it calls people nobody
selected. Nobody flagged resolves to an EMPTY audience, never an absent
filter, for the same reason.

AND-ed with an activity condition pinned to one outreach, it expresses "who
from that closed campaign still needs calling back" — which is what the
results drawer's follow-up block saves, and what phone banking then builds a
call sheet from. Because it reads the standing flag, that list shrinks as the
official works it down, while the campaign's own `byFollowUp.yes` count is
frozen history and can only grow; the two are supposed to disagree.

`ContactEngagementService` filters the feed's `contact_status_event` read by
field rather than skipping it for Serve: `field: follow_up` for an `eo-` org,
`field: { not: follow_up }` otherwise, so neither surface can read back the
answer to a question its own canvassers never asked. `findPerson` includes
`followUp` on the person payload for `eo-` orgs only, the exact mirror of
`voterLikelihood`'s Win-only inclusion.

### Serve's civic panel

User-facing it is the "civic panel". Every surface that offers it is behind
the `serve-citizen-panels` Amplitude flag (`SERVE_CITIZEN_PANELS_FLAG`): the
`PATCH /civic-panel` route 404s with it off, and the webapp hides the record
toggle, the list-builder groups, the door and call question, the SMS ask and
the printed panel column. The data paths below stay live, so nothing is
written with it off except by a flag-on surface.

`ContactStatusField.civic_panel` is the layered status model's sixth field:
the constituents who said yes to being asked for feedback. Each office has one
panel, so the people at `member` are the panel. Vocabulary is
`CivicPanelStatus { member, left }`, with `left` a real value so a reversal is
recorded, same as `do_not_knock` (who joined and who left, and how, is the
history an official will be asked to account for). It is built exactly like
`follow_up`: written through `ContactStatusService.changeStatus`, Serve-only
in both directions, seeded `left` because nobody is a member until they say
yes, on the person payload for `eo-` orgs only, and read back in the Serve
half of the activity feed's field filter. The contact card writes it
(`updateCivicPanel`, `source: manual`).

The Serve door and call flows close with an optional "Do they want to join
your civic panel?", for a resident who says they want in during a knock or a
call about anything. It never blocks saving the outcome, and no door or call
script, walk list or call list has to carry a panel ask. It is stored as `join_civic_panel` (`FollowUpAnswer`) on
`contact_interaction_door_knock` and `contact_interaction_phone_banking` as
history for that one knock or call. Two writers turn a yes into
`civic_panel = member`: `ContactInteractionDoorKnockService.emitCivicPanelEvent`
(`source: door_knock`, `sourceId` stable per synced knock so a replay no-ops)
and `PhoneBankingCallService.emitCivicPanelEvents` (`source: phone_banking`,
`sourceId` stable per call and answer, so re-saving a yes never re-enrolls
someone who left). Both carry the `eo-` guard
and `fallbackFromValue: left`. Unlike follow-up, **only a yes writes**: a no at
one door is not leaving the panel, so it never demotes a member.

**Panel-only outreach asks to stay instead.** A saved list that can only hold
current members is "panel-only" (contracts' `isCivicPanelOnlyList`:
`civicPanelMember` without `civicPanelLeft` or `civicPanelNeverInvited`, which
OR with it, or any joined-by / joined-when criterion, which matches members
only; other criteria only narrow, and a panel-plus-fresh sample never asks for
membership in its criteria). On a panel-only turf or call list the closing
question is "Do they want to stay on your civic panel?", stored as
`stay_on_civic_panel` (`FollowUpAnswer`) beside `join_civic_panel`, never both
(the contracts refuse the pair). A no writes `left` (`source: door_knock` /
`phone_banking`, `sourceId` `<knock or call>:stay:no`); a yes writes nothing,
so it never re-enrolls someone who left since. The server decides panel-only
from the turf's or list's own `VoterFileFilter` (`CIVIC_PANEL_ONLY_SELECT` in
`src/voters/util/`) and drops a stay answer from any other list, so a no on a
non-panel list still never demotes. The route payload and the phone banking
list carry `civicPanelOnly` so the walk, the caller page and both paper
formats ask the right question. Leaving otherwise is the contact card, a
texted LEAVE, or a texted STOP.

A Serve text asks with a fixed, locked sentence (`CIVIC_PANEL_JOIN_LINE` in
contracts: "Reply JOIN to join my civic panel. My office will text you
about once a month to ask what you think before I decide. Sent with
GoodParty.org.", in its own paragraph above the opt-out), and the create
stamps `Outreach.asksToJoinCivicPanel` from the stored message. The create
and the composer's lock recognize every wording in `CIVIC_PANEL_JOIN_LINES`
(`findCivicPanelJoinLine`), because sends written before the line was
rewritten carry an earlier one; the composer only writes the current line. The reply ingest
(`OutreachTextIngestService.applyCivicPanelEvents`, `source: sms`, `sourceId`
the reply's message id) writes `member` for a JOIN reply
(`util/civicPanelJoin.util.ts`: the whole reply or a sentence of its own) on
a send that asked, and `left` for any STOP on any Serve send, because panel
membership is not consent to text. A LEAVE reply
(`util/civicPanelLeave.util.ts`, same matcher style) also writes `left` on any
Serve send, whether or not it offered LEAVE, and is not an opt-out: the person
keeps getting the office's texts. From someone not on the panel it writes
nothing (`left -> left` is a no-op), and a reply saying both JOIN and LEAVE
reads as LEAVE. Replies apply in sent order, and a JOIN
from anyone who has opted out on any send is skipped, so a STOP stays the
last word across uploads.

A text to a panel-only list carries `CIVIC_PANEL_LEAVE_LINE` ("Reply LEAVE to
leave my civic panel.") instead of the JOIN line, appended and locked by the
composer the same way, and the create stamps `Outreach.offersCivicPanelLeave`
from the stored message. The create 400s a message carrying both lines, and
the LEAVE line on a list that is not panel-only; the controller refuses it
with `serve-citizen-panels` off, like the JOIN line.

**The audience side.** `voter_file_filter.civic_panel_member` is the saved-
filter dimension for the panel, built exactly like `follow_up_requested`:
`ContactStatusService.personIdsByFieldValue(civic_panel, [member])` into an
`id: { in }` constraint, AND-composed after the follow-up resolution in the
Serve branch of `resolveIdFilterWithContactsMade` and in
`resolveSavedFilterSets`, listed in `fieldsHandledSeparately`, and 400'd for
a Win org by the same gate as follow-up. An empty panel resolves to an empty
audience, never the district. Because it reads the standing status, someone
who left drops out of a saved panel list on its next read. The catalog entry
(`civicPanel`, `modes: 'serve'`) is what lets the Chief of Staff and the
priority agent count and propose to the panel. It is not flag-filtered:
with nobody on a panel it resolves to an empty audience.

**The panel's history as filters.** The rest of the panel status group sits
beside `civic_panel_member`, and they OR together:
`civic_panel_left` is a standing `left` row. `civic_panel_never_invited` is
not in the catalog or the lists UI; only the managed wave draw's criteria
use it. It is everyone outside `CivicPanelHistoryService.invitedPersonIds` (any
`civic_panel` status row, any recipient of a send with
`asksToJoinCivicPanel` in `outreach_text_recipient` or
`contact_interaction_text`, and anyone with a non-null `join_civic_panel`
answer at a door or on a call). A status row only exists once an event wrote
one, and `changeStatus` no-ops `left -> left`, so someone seeded `left` who
never joined counts as never invited, never as left. Never invited resolves to
a `notIn` (minus whichever of member/left is also picked). The joined group,
`civic_panel_joined_by_{text,door,phone,hand}` (source `sms`, `door_knock`,
`phone_banking`, `manual`, OR-ed) and `civic_panel_joined_from`/`_to`, reads
the event that most recently set a person to `member`
(`memberIdsByLatestJoin`, `DISTINCT ON` over `contact_status_event`) and
matches current members only, so it never selects someone who left.
`last_reached_from`/`_to` ("Last asked" in the webapp) is when the office last
reached the person on any channel, `MAX(occurred_at)` over the four
interaction tables (`ContactsMadeResolutionService.personIdsLastReachedBetween`),
the same rule as `not_contacted_recently` and `reachedRecently`, so "not asked
in 30 days" is that existing key. Days are inclusive `YYYY-MM-DD` text read in
UTC. All resolve in `resolveCivicPanelMember` (status, then joined, then last
reached, each AND-ed), every one is in `CIVIC_PANEL_FILTER_KEYS` for the Win
400, and the catalog carries the user-facing ones as `civicPanel`, `civicPanelJoinedBy`, and
two `date-range` dimensions (`civicPanelJoinedWhen`, `lastAsked`), all in
`CITIZEN_PANEL_DIMENSION_KEYS`. `findPerson` adds `civicPanelActivity` for
`eo-` orgs: the latest `civic_panel` event (`value`, `source`, `at`) and
`lastReachedAt`, the line under the record's toggle.

**The home's civic panel cards.** With the flag on, `GET
/v1/dashboard/cards` runs `DashboardCardsService.syncCivicPanelCards` before
it lists (with it off, it lists no `civic_panel` card at all): the managed
panel's offer and progress cards (see "Managed civic panel") and a
`civic_panel` next-step card per open priority with a step left
(`currentStepOf` not null), which opens the priority. Its summary is what the
Priorities page shows: `nextAction`, or with none, the current step's
`PRIORITY_STEP_LABELS` label (an unknown step id reads as the first step). It
has no Mark done (`complete` ignores every `civic_panel` card; one already
done stays done); it takes `dismiss` (Not for me, undone by `restore`, Bring
it back in the archive), `snooze` (Show in 3 days: `snoozedUntil` keeps it
off the active list for `DASHBOARD_CARD_SNOOZE_DAYS`) and `restore`. While
open its due date rolls forward. It is deleted, skipped or not, once its
priority is archived, and recreated if it is unarchived; a ready plan (null
step) deletes it too, unless it is done, and it is recreated when a step
comes open again. The webapp leads with the Chief of Staff's `meet`
get-started card while it is active, then any open `report_back` card on a
good read (`isGoodReadReportBackCard`: its `sourceItemId` is the read status
it was made for), then the managed panel's cards under the People first
headline, then the `priorities` get-started card, then the rest, a report
back before a good read among them. `meet` is done only once its button
opens the intro (`PUT /v1/dashboard/onboarding-cards/meet/complete`, an
`OnboardingCardCompletion` row), never by any Chief of Staff conversation.
One advisory lock per office serializes the sync, because the managed cards'
null `sourceItemId` leaves the unique key unable to stop a second insert.

**Reporting back is a card too.** The same read runs
`DashboardCardsService.syncReportBackCards`: one `report_back` card per
priority with a text whose replies are in
(`OutreachReportBackService.repliesInWhere` in `src/outreach/`) and at least
one answer, `sourceExternalId` the priority's id and `sourceItemId` its read
status, due `REPORT_BACK_DUE_DAYS` (14) after the read that made it, opening
`/dashboard/priorities/<id>?reportBack=<outreachId>` on the priority's latest
such text. A new card is made each time the read status changes, and the open
card of another status is deleted, so only one is open. Its words say where
the read stands and what to do, rewritten on read like the managed cards'. It is
done once a text with `reportBackForOutreachId` on one of the priority's
texts is past checkout after the card was made
(`OutreachReportBackService.sentReportBack`), and takes the same Mark done,
Show in 3 days, Not for me and Bring it back. The report back goes to
everyone who answered the priority on any channel, each once
(`priorities/util/priorityRespondents.util.ts`, `answeredPersonIds`). Flag
off, no `report_back` card is made or listed.

**The rest window.** `voter_file_filter.not_contacted_recently` (both
products) leaves out anyone the org reached on any channel in the last
`CONTACT_REST_DAYS` (30): `ContactsMadeResolutionService.personIdsContactedSince`
unions the four interaction tables on `occurred_at` into an `id: { notIn }`
constraint, applied before the Win/Serve split in
`resolveIdFilterWithContactsMade` and in `resolveSavedFilterSets`. It is read
when the list is read, so people come back in as their window passes.

**The panel as a whole.** `CivicPanelSummaryService` backs the Serve
Contacts page's "Your civic panel" section and its page. Members are
the standing `member` set; `reachedRecently` is
`countContactedSinceAmong(CONTACT_REST_DAYS, members)`, the rest window's
rule counted in SQL over the member ids (so a busy office never hits the
contacted-set cap), and `askableNow` is exactly who a panel list with "Not
contacted in the last 30 days" holds. The same read carries `progress`,
`balance` and `composition` (see "Sizing and steering the panel"): the panel
page and the Constituents section draw their seats and milestones from it.

The built-in panel list's outreach history
(`ContactsService.civicPanelOutreachHistory`) is every send of the org that
reached at least one current member, read off the same four interaction
tables as `reachedRecently` and "Last asked"
(`ContactsMadeResolutionService.outreachIdsReachingAmong`: a text, robocall
or knock row names its send, a call row names its list, whose envelope is the
send; manual logs name none). Only sends past checkout count
(`UNSENT_OUTREACH_STATUSES`), in a saved list's order and shape
(`VoterFileFilterService.findSentOutreachesByIds`). Someone who left is not a
member, so a send that reached only them is not in it. The summary's
`lastOutreachAt` is that history's newest row (`date`, else `createdAt`), so
the list row's "Last outreach" agrees with the sheet without its voter-file
aggregates.

### Sizing and steering the panel

The managed panel's waves (below) and the panel page both read the panel
against the district: the member goal, the groups it covers, and who is
short. `CivicPanelSummaryService` computes it on every `GET /civic-panel`.

**Sized for coverage.** The member goal is the members it takes for every
major group to be expected to answer one question three times.
Officials never see the answer count behind it; the panel page shows the
groups covered.
Contracts' `answersNeeded(smallestMajorShare)`
(`outreach/AnswersNeeded.const.ts`) is `ceil(MIN_VOICES_PER_GROUP /
share)`: enough answers for the district's smallest major group (one
holding `MAJOR_GROUP_SHARE`, 3%, or more on age band, gender, tract, or race
when `raceNameable` holds for the district) to be expected to answer 3
times. 100 where that group is 3% of the district, 15 where it is 20%.
`CensusCompositionSource.districtAnswersNeeded` reads it from the
district's cells (`smallestMajorShare` in
`utils/civicPanelAllocation.util.ts`, over the same census-reweighted frame
the priority model reads, cached 15 minutes per district); without them (no district row, no
district, or a failed read) it is `answersNeeded()`, 100, the most any
district needs. The panel's own math is in
`contracts/src/people/PanelAnswers.ts`: `panelGoalMembers(answers)` is
`ceil(answers / PANEL_ASSUMED_REPLY_RATE)`, 250 at most. A priority's checks
are not sized here: see "Round 1 sizing" below.

**Progress.** The summary's `progress` is `{ members, goal, answersNeeded,
expectedAnswers, groupsCovered, groupsTotal }` (`CivicPanelProgressSchema`):
`goal` is the district's `panelGoalMembers`, `expectedAnswers` is
`panelExpectedAnswers(members)`, members × `PANEL_ASSUMED_REPLY_RATE`,
rounded; the sizing fields never reach a screen. `groupsCovered` of
`groupsTotal` is `panelCoverage` (`utils/civicPanelSteering.util.ts`): the
major groups (age band, gender, tract, and race when `raceNameable` holds)
holding at least `PANEL_MEMBERS_PER_GROUP` (8: three answers at the 40%
answer rate) members. The census is read for any panel with a member, and
both are 0 when it cannot be.

**Active members past the goal.** A panel past its goal is judged on active
coverage. An active member is a panel member who answered a priority's text,
call or door in the last `PANEL_ACTIVE_WINDOW_DAYS` (90) days
(`answeredPersonIds` with no priority and a `since`, read live from the
interaction rows, never stored; opted-out people do not count). Past the
goal (`members >= panelGoalMembers`) the summary also counts them the way it
counts members (`activeMixOf`, the same census cells and the same groups,
with race named only when it is for the members) and every major group is
judged on `PANEL_MEMBERS_PER_GROUP` active members. `balance` keeps its
member-based `status` and gains `groupsNeedingFresh`, the groups short of
active members, with `inviteMore` the largest group short of members, else
of active members; absent before the goal. See
`docs/adr/2026-10-20-civic-panel-active-members-read-live.md`.

**Steering by census** (`utils/civicPanelSteering.util.ts`, Bryan,
2026-10-18). Each draw leans toward the groups the panel trails, so the
panel drifts toward the district's census mix. Dimensions are age (the
census's six adult bands, 18 to 24 through 65+), gender (census sex against
the voter file's `M`/`F`), tract and race, all from `weightingTargets`. Tenure
is out until a statistician rules on its household target. Race (Bryan and
Samuel, 2026-10-19) is L2's
modeled `EthnicGroups_EthnicGroup1Desc` folded into white, Black, Hispanic,
Asian and other against all-ages ACS shares (Native American and any group
under 2% of the district fold into other). It leans a draw and names a
group only when `raceNameable` holds (at least `MIN_KNOWN_RACE`, 10,
members with a known value and `MIN_KNOWN_RACE_SHARE`, 70%, of them);
otherwise race sits out the panel entirely. `other` is never leaned toward
or named. Race is read only into counts and draw weights, never onto a
person or a filter: the Serve ethnicity gate below is unchanged.
`CensusCompositionSource.weightingInputs` reads the members' cells and the
census (`findWeightingInputs`), cached 15 minutes per office and member set
in the summary service; a failed read leans nowhere. Draw weights come
from gaps: census share (`weightingTargets`: ACS adults by sex and age band,
adults per tract over the block groups the district's people live in)
against the members' unweighted share
among those with a known value, values under
`MIN_ANSWERS_PER_WEIGHTING_GROUP` (5) members pooled into `other`.
A wave's text draws weighted: per value `clamp(c / p, 0.5, 2)`
(2 where `p = 0`), a person's weight the product clamped to [0.5, 2],
passed as `drawListSample`'s server-only `weights` and applied in
`buildSampleSql`'s order. Nothing leans below `PANEL_MIN_MEMBERS_FOR_BALANCE`
(30) members. A wave's `steeredToward` (`UnderrepresentedGroup`) is written
when it is drawn. The summary's `balance`
(null when the census cannot be read) is the panel's one status, in its
own words (`CIVIC_PANEL_BALANCE_STATUS_LABELS`, never the priority's
labels): `tooFewMembers` under 30 members, then `missingGroups` while any
major group is short of members, else `everyGroup`. `inviteMore` is the
largest missing group, set whenever groups are missing, even once the goal
is met; a wave's `steeredToward` is that same group (draw weights still
follow the share gaps). The balance section's line names the next group.
The official never sees a share, weight or target as a number. The
summary's `composition` (null with no members, or when
nothing can be read) feeds the panel page's seats and petals: `places` is
every census tract from `weightingTargets`' tract shares with the members
living there (`panelComposition`, `placeKind: 'tract'`, `name` the tract
number, `label` its human name, below), or, when the census has no tract for the district, every
(County, Precinct) by its share of the people on file with the members
filed there (`precinctPlaces` over `VoterQueryService.findPrecincts` and
`findPrecinctMembers`, `placeKind: 'precinct'`, the unknown precinct left
out). `groups` is each major group by age, gender and nameable race with
its district share and the members' share among those with a known value,
from the same mix the balance reads. The page draws seats and petal
lengths from them and shows only seats and "X% of its share".

**Tract names** (`CensusTractNameService`, `utils/censusTractName.util.ts`,
Bryan, 2026-10-22). A tract place carries `label`, its human name, once it
has one; without it the page shows the number. Names live in
`census_tract_name`, one row per 11-digit GEOID, kept forever (see
`docs/adr/2026-10-23-census-tract-names-filled-on-managed-approval.md`).
Every summary read looks them up (one Postgres read). Names are filled in
the background when an office approves its managed civic panel (first
approval or re-approval after stop, not a repeat), for every tract in the
district's census tract list, so they are usually ready before the official
first opens the panel page. As a backstop, a summary read that finds a tract
with no row names the missing ones after its response. Naming reads each tract's mean resident point and
top street in one aggregate (peopleDb `findTractPlaces`), writes the street
name ("around Haywood Rd", source `street`, else `none`) to claim the row,
then reverse geocodes the point (`GeoapifyReverseGeocodeService`, one
credit) and takes the first of `neighbourhood`, `suburb`, `quarter`,
`district` that is not the city, county or road (source `neighborhood`). A
failed call deletes the claim, so a later read tries again; a road-only
answer keeps the street, and is never asked again. Labels are made
distinct within the district at read time: two tracts in one neighborhood
add their top street ("West Asheville, around Haywood Rd"), and any still
alike add "(Tract 25.03)". About 1 credit per tract, once: a city council
district of 15 to 40 tracts costs 15 to 40 credits, ever.

**Round 1 sizing** (`sizeRoundOne` in `utils/civicPanelAllocation.util.ts`,
Samuel, 2026-10-19; text only, Bryan, 2026-10-23).
A priority check's first round is one text, which the priority chat proposes
as one card (`size_round_one`,
`chats/general/chat-tools/sizeRoundOne.tool.ts`). A major group holds
`MAJOR_GROUP_SHARE` (3%) or more of the district on a steered dimension:
age band, gender, tract, and race only when `raceNameable` holds for the
text pool, never `other`. District shares are
`weightingTargets` of the census (`PriorityResultsService.districtCensus`),
or the text pool's own mix when the census cannot be read. The pool is
counted by group in the warehouse (`ContactsService.countByGroupWithin`,
peopleDb `buildPoolCellsSql`, counts only): `notContactedRecently` and
`hasCellPhone`. A group's expected answers are the texts times its share of
the pool times `TEXT_ANSWER_RATE` (3%, a placeholder until offices measure
it). The text is the most any group needs to reach `MIN_VOICES_PER_GROUP`
(3), `3 / (share × rate)`, capped by the reachable cell phones and
`MAX_LIST_SAMPLE_SIZE`; a group no cell phone reaches does not size it.
That text is one purchase in two rounds
(`splitPriorityText` in contracts): its card's `sampleSize` is the half
sent at random on the chosen date, and `roundTwoSize` the half held for a
follow-up two weeks later, drawn toward the groups heard from least
(Samuel, 2026-10-20), sized at checkout to at most 90% of the people left
after the first half. A text too small for two halves of 25 goes out
whole. The tool says whether every major group
reaches 3 (`coversEveryGroup`).

**Round 2 targeting** (`utils/civicPanelAllocation.util.ts`, called by
`priorities/services/priorityRoundTwoDraw.service.ts`). Leans a priority's round 2 text, drawn on its scheduled date, toward
the groups a model of the round 1 answers is least sure about, rather than toward census gaps:
`batchTargets` ranks groups under `MIN_VOICES_PER_GROUP` (3) first, then by
share times range width; `batchWeights` turns that into the same
`SampleWeights` this steering passes, within [0.5, 4]; `splitBatch` keeps
`UNSTEERED_BATCH_SHARE` (15%) of the send unsteered. Groups under
`MAJOR_GROUP_SHARE` (3%) and the pooled `other` are never leaned toward, and
the caller leaves race out unless `raceNameable` holds. The model is
`priorities/util/mrp.util.ts`. Design and what is left:
`docs/features/civic-panel-mrp.md`.

**Analytics** (`EVENTS.Contacts` in `segment.types.ts`, sent to the
office's user through `trackForOffice`; ids, counts and enums only).
`Contacts - Civic Panel Membership Changed` fires from
`ContactStatusService.changeStatus` for every civic panel write, with the
from and to status, `source` (text, call, door or manual, from
`MEMBERSHIP_SOURCE`) and `managed` (the office has a managed civic panel that
is not stopped). The browser fires `Contacts - Civic Panel Viewed` itself. The managed civic panel's events are in
`flows-managed-civic-panel.md`.

# Gate (milestone 2)

<!-- Moved verbatim from outreach/AGENTS.md so the auto-loaded AGENTS.md stays small. Edit here. -->

`v2/gate/` holds the in-flow Pro/verification gate that pauses a channel flow
until the candidate can send. `gateCopy.ts` is every string it (and the
screens it mounts) use — never add gate copy elsewhere. `useOutreachGate.ts`
is thin over `useOutreachProGatingV2Flag(false)` +
`shared/membership/useMembershipState`, mapping flag + `MembershipState` to a
`GateRequirement` (`'pro' | 'verify' | 'in_review' | 'pin' | 'closed' | null`)
for one channel; a Serve org and texting already cleared both resolve to
`null`, and only `sms` (`twoStep`) can ever reach
`verify`/`in_review`/`pin`/`closed` — every other channel needs Pro alone.
`closed` is checked before the Pro requirement (see "SMS compliance cutoff"
below). `GateBanner.tsx` is the footer's tinted one-liner
(`null` off `requirement`), tapping it opens `GateExplainerModal.tsx`. Since
the 2026-09-21 design the explainer and the Pro wizard's `InterstitialStep`
share one `ProPitchPanel.tsx`: a channel-tinted value card (the channel's
`PRO_COPY` headline plus its three `bullets`) and, for `sms` only, a
collapsible "Campaign verification included" card holding the `$120`
registration-fee pill. The explainer passes `hideValue` /
`verifyDefaultOpen` for any requirement past `'pro'`, so an already-Pro
candidate lands straight on the verification detail. `OutreachGate.tsx`
renders the paused-flow screen itself, and reports what the sheet's header
should read while it is up through `onChromeChange` (`GateChrome`: the phase
overline — `GATE_CHROME_COPY`'s "Upgrade to Pro" / "Campaign verification" —
plus the gate's own step position; `totalSteps` 0 is a screen with no
header, the pause, success and pending screens). The two drafting flows hold
that in state and hand it to `OutreachFlowShell` in place of the channel
badge and the flow's own step count (design: `renderSgModal`). The wizard
steps inside stretch to the sheet (`OutreachSheet`'s body is a flex column
all the way down) so their footer rows pin to the bottom with a ghost Back
and a 360px Continue, as the design draws them. `'pro'` mounts `ProUpgradeFlow` on
`PRO_UPGRADE_STEP.INTERSTITIAL` when `showInterstitial` is true — the two
drafting flows pass `gateOrigin === 'save'`, so only the save that just wrote
the draft gets the pitch — and on `PRO_UPGRADE_STEP.GUIDANCE` otherwise: a
tile or row click on a saved draft, the explainer's Join Pro (which already
made the pitch), and phone banking's and door knocking's gates all open on
the wizard's first step (design: `sgOpen(..., skipPause)`). Every gated flow
also passes `locked` to its header `ChannelBadge` while `requirement` is
non-null and the gate is closed, which trails the label with the lock glyph
(design: `channelBadge(ch, locked)`);
`'verify'` mounts `CampaignVerificationSteps`; `'pin'` mounts `PinDialog`
behind a short notice card, taking its `onSuccess` as the gate's completion
(a dismissal is still an exit — reading a verified PIN as a close dropped the
candidate out of the sheet at the end of the texting journey); `'in_review'`
renders its own notice card. None of these screens offers Delete: a saved
draft is discarded from its history row's drawer (see above).

**Finishing the gate means whatever the gesture that opened it was about.**
The banner rides every build-mode step, so its explainer can open the gate
from anywhere — long before there is a draft, or a call list, or a route. So
every mounting flow tracks a gate ORIGIN and branches the completion on it:
`v2/gate/useDraftGate.ts` carries `'save' | 'resume' | 'explainer'` for
texting and robocall (save/resume hand the row over to the schedule step,
explainer-with-no-draft closes and leaves the candidate on the step they were
on, explainer-with-a-draft behaves like a resume), and phone banking and door
knocking each hold the same two-valued state in front of their single paid
write, which runs only for the origin that pressed for it. Build mode then
turns itself off once `requirement` is null; for sms the requirement may move
on to `verify` instead, in which case the banner stays and the flow keeps
building, which is correct.

**`v2/gate/useDraftGate.ts` owns every saved-draft concern the two drafting
flows share** (its resume effect is keyed on `open` as well as `resumed`: the
flow stays mounted between opens, so the second open of the same draft used
to find `resumed` already true, never re-open the gate, and land the
candidate on the schedule step of a text they could not send): `savedDraft`, `resumed`, `gateOpen`, `explainerOpen`, the
origin, the save (201 → gate on `'save'`; 409 → fetch the existing row,
switch to resume, land on schedule), the completion, and the `Draft.Saved`
event. `SmsFlow` and
`RobocallFlow` keep only what is theirs: the payload their channel posts,
their step ids, and texting's phone-list derivation. `v2/gate/testing/
mockReactiveGate.ts` is the reactive stand-in every flow test mounts for
`useOutreachGate` — a module singleton rather than a `vi.hoisted` ref,
because a `vi.mock` factory cannot close over a test file's own variables but
can `await import` this one.

**The gate LATCHES its screen, and no flow may close it on a requirement
change.** `requirement` is derived from the same campaign cache
`ProUpgradeFlow`'s `SuccessStep` polls, so it clears the instant payment
lands — while the candidate is still looking at the success screen with
Continue in front of them. So `OutreachGate` takes its screen once, on the
false → true transition of `open`, and renders that regardless of what
`requirement` does afterwards; only `handleProComplete` moves it, re-reading
the live requirement when the candidate presses Continue and switching to
`'verify'`/`'in_review'`/`'pin'` (texting's second step, which only `sms` can
reach) instead of calling the caller's `onComplete`. The wizard collects the
filing before payment, so a texting candidate who walked it comes back with a
`submitted` record and moves on to `'in_review'`, the gate's own notice, never
back into the filing form; `'verify'` is left for a candidate who was already
Pro with no filing on record. A gate opened with `requirement === null` still
renders nothing. The mirror rule in the flows:
the resumed effect is OPEN-only (`if (resumed && gate.requirement !== null)
setGateOpen(true)`) and phone banking's sheets gate has no auto-close at all
— the gate closes through `onExit` or `onComplete` and nothing else.
Closing it on the flip is what made the completion (the `createList` on
phone banking, `handleGateComplete`'s landing on `schedule` for the other
two) unreachable. `OutreachFlowShell`'s `banner` slot renders whichever of
these a mounting flow passes, above the CTA row, inside the footer — a
banner alone still renders the footer. **The caller gates the JSX, not the
shell**: a React element is truthy even when it renders null (`GateBanner`
returns null once nothing is gated), so `OutreachFlowShell`'s `showFooter`
can't tell a gated banner from an ungated one by the prop alone — pass
`banner={state.requirement ? <GateBanner ... /> : undefined}`, never an
unconditional `<GateBanner ... />`, or an ungated flow gets an empty footer
bar. `v2/sms/SmsFlow.tsx` is the mounted reference (see its row above for
the build/resume shapes), `v2/robocall/RobocallFlow.tsx` mirrors it for
the one-step Pro gate, and `v2/phone-banking/PhoneBankingFlow.tsx` mounts
the same three pieces in front of its single write (no draft, no resume —
see its row above), and `door-knocking/native/createFlow/CreateListFlow.tsx`
mounts them in front of Build route, its one paid write.

**The flag also opens the front doors.** Gating inside a flow is only
reachable if the candidate can get into the flow, so with the flag on the
tiles (`v2/ChannelTileGrid.tsx`) and the `?compose=` deep link
(`components/OutreachComposeDeepLink.tsx`) stop refusing a free candidate
for text, robocall, phone banking and door knocking. Door knocking's page
(`door-knocking/native/DoorKnockingPageGate.tsx`) admits a free campaign
under the same flag, since the three reads its map needs (`GET turfs`, `GET
pack`, `POST audience-check`) are open to one server-side; only the Geoapify
spends are still gated, and that is where its create flow's in-flow gate
stands.

**Five outreach routes are relaxed for the build path** (`POST
/v1/outreach/sms/draft`, `POST /v1/outreach/robocall/draft`, `POST
/v1/outreach/robocall/number`, `POST /v1/outreach/robocall/audio/presign`,
`POST /v1/outreach/robocall/compliance`), plus, outside the module, `POST
/v1/voters/voter-file/filter` and the four count reads the audience step
prices a list with (`POST /v1/contacts/count`, `POST
/v1/contacts/overlap-count`, `GET` and `POST /v1/contacts/list-detail`) and
door knocking's four map reads. Everything else a paid send touches still
requires Pro — see `packages/gp-api/src/outreach/AGENTS.md`.

**A free candidate on the build path gets the whole audience step** (design:
"All lists" and "Create a new list" sit under the recommended card for
everyone). The count reads that price a saved or built list are open to a
free campaign server-side, so nothing here branches on the tier; the one
free-tier wrinkle left is that a recommendation accepted straight off its
card keeps the card's own count against the saved list it becomes
(`recommendationSnapshot` in the hook), which is what the schedule and review
steps read until list-detail answers.

**Known limits.** Two rough edges are accepted for this milestone rather than
overlooked. A mid-session flag flip while the candidate is building changes
the step order under them (build mode drops the schedule step, so it
reappears or vanishes between one step and the next). And a robocall re-record
on a resume orphans the previous audio object and its compliance row: the
resume writes a new `audioKey` and nothing cleans up the old one, which only
the draft-expiry teardown would have reached.

A gated flow's draft is a real row, not flow state, and `helpers/createOutreachDraft`
owns both shapes of the write. Texting goes through `createOutreachDraft` —
multipart, since the image rides along, so it posts `apiRoutes.outreach.drafts`
via `gpApi/outreachDraft.api.ts`'s untyped `clientFetch`. Robocall goes through
`createRobocallDraft` — no file, so it posts the SAME route as typed JSON
(`POST /v1/outreach/drafts` in `api-endpoints.ts`) and the throw is mapped
rather than a status read. Both return `{ draft, conflictId }`: a 409 carries
`existingId`, so the caller resumes the row the campaign already has instead of
showing an error. Scheduling that row later is the channel's ordinary create
carrying `draftOutreachId` — `POST /v1/outreach` for texting (no file, the row
holds the image), `POST /v1/outreach/robocall` for a call (re-sending the row's
own `audioKey`/`callbackNumber`, read off `OutreachDetail.robocall`) — which
converts it in place; discarding it is the typed `DELETE /v1/outreach/:id`,
draft rows only.

**Analytics for all of this is `EVENTS.Outreach.Draft` and
`EVENTS.Outreach.Gate`** (`helpers/analyticsHelper.ts`), and every one of the
seven carries `channel` in the gate's own vocabulary (`GateChannel`: `sms`, not
`text` — `OutreachHubPage`'s `GATE_CHANNEL` translates). `Draft.Saved` fires
from each flow's `handleSaveDraft` on the 201 only, never on the 409 (that
wrote nothing). `Draft.Resumed` fires once, in the hub's `openChannel` — the
single place the tile, the row click and the deep link all pass through — and
carries `source` (`tile` | `row` | `deep_link`) — a row click reaches it
through the drawer's CTA. `Draft.Deleted` fires from the drawer after the
`DELETE` lands. The gate events add `requirement`: `Gate.BannerViewed`
once per banner APPEARANCE (a ref + a `[visible]` effect, the
`MembershipBanner` pattern — a requirement moving on under a banner still on
screen is not a second view), `Gate.ExplainerViewed` once per open, and
`Gate.ExplainerCta` on every footer button including the "Later" dismiss,
naming it in `cta` (`upgrade` | `verify` | `pin` | `dismiss`) — the dialog's
X is not a footer button and reports nothing, so a `'pro'` explainer, whose
only way out is the X, has no dismiss event. `Gate.InReviewViewed` fires from `OutreachGate` each
time the in-review notice opens, with `channel` only (its requirement is
always `in_review`); the gate's Pro, verification and PIN screens report
through `ProUpgradeFlow`, `CampaignVerificationSteps` and `PinDialog`. The deep link's own
`ClickCreate` carries `resumed: true` when the arrival will resume a saved
row, which the hub answers through its `resumesDraft` prop — the deep link
cannot see the history itself, and without it a resume counts as a create.

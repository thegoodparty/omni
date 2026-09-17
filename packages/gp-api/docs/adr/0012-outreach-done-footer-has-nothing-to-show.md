# 0012 — The `done` footer's primary slot, and why it stays empty

Status: accepted

## Context

The list details drawer's footer is a closed set of four modes
(`packages/gp-webapp/app/dashboard/outreach/v2/listDetails/footerMode.ts`). Three
of them render. The fourth, `done`, has a primary slot the Voter Outreach 2.0
canvas fills with **"Show results"** — or **"Show post"** on social — and ours is
empty. `SHOW_RESULTS_LABEL` and `SHOW_POST_LABEL` are exported from that file and
imported by nothing.

The first thing to correct is the shape of the gap. `done` is not an empty mode:
`OutreachDetailsDrawer` gives it Delete (phone banking, the only channel with a
delete endpoint), Archive/Restore, and the note pointing door knocking's archive
back at its own surface, and `TurfDetailsSheet` gives it the shelf action. What is
empty is one slot — the canvas's primary CTA — and the question is only whether
anything can go in it.

PR #1396 shipped the vocabulary without the buttons and said the data wasn't
there. This is the audit of that claim.

## What a completed campaign actually knows about itself

| Channel              | Recipients                                                         | Outcomes captured                                                | Aggregated anywhere                     |
| -------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------- |
| `nativePhoneBanking` | yes                                                                | call outcome + support answer                                    | **yes** — `OutreachDetail.phoneBanking` |
| `nativeDoorKnocking` | on the turf/route                                                  | knock outcome + support answer, in `ContactInteractionDoorKnock` | no                                      |
| `text` / `p2p`       | yes — one `ContactInteractionText` row per recipient at launch     | `respondedAt` / `optedOutAt`, swept hourly from Peerly           | no                                      |
| `robocall`           | yes — one `ContactInteractionRobocall` row per recipient at launch | **none**                                                         | n/a                                     |
| `socialMedia`        | n/a                                                                | **none** — no `ContactInteraction` model                         | n/a                                     |

Robocall is the surprising row. `answeredAt` and `voicemailLeftAt` exist as
columns, so the schema reads as though outcomes are captured. The only writer is
`ContactInteractionsController`, the manual per-person log, and it sets
`outreachId: null` — by design, because a hand-logged call is not attributable to
a send. `OutreachInboundSweep` is scoped to `text` and `p2p`. So every row a
robocall campaign materializes has both timestamps null forever, and a robocall
campaign knows exactly who it tried to call and nothing about what happened.

### There is exactly one results surface, and it is not a destination

No route in the webapp renders campaign results. The one place outcomes appear is
a **section inside the drawer body** — `OutreachDetailsDrawer`'s "Results", shown
for a completed `nativePhoneBanking` row: the outcome breakdown and the support
tally, off `PhoneBankingOutreachDetail`. `OutreachHistoryTable`'s results column
returns "—" for every other channel and says why: the per-channel result sweeps
are phases 2–4, and social's engagements are cut from v1 by the channel spec.

Door knocking has no results surface either, which is worth stating plainly
because it is easy to assume otherwise. `TurfDetailsSheet` shows Doors, People,
Route type, Created and People logged — that is progress, not outcomes. The knock
outcomes and support answers exist in `ContactInteractionDoorKnock`; nothing
aggregates them per campaign, and nothing maps a route id back to the turf that
would have to be aggregated.

This is what makes "Show results" the wrong shape rather than merely unbuilt. It
is a navigation affordance, and on the one channel that has results the
destination is the surface the button would sit on. If text results ship they
should ship the way phone banking's did — a section in the body, beside the
Overview — and the primary slot is _still_ empty afterward.

### Nothing anywhere records where a post went

`OutreachSocialAsset` is `{ platform, kind, text, caption }`: generated copy, per
platform. The drawer's own words for it are "The text created for each platform.
Copy any post again below."

There is no publish step to hang a URL on. No OAuth to any of the six platforms in
`SocialAssetPlatform`, no publish endpoint, no webhook, no audit row — `postUrl`,
`permalink` and `publish` appear nowhere in any outreach path. The candidate
copies the text and posts it from their own account, and we never learn that they
did, let alone where. "Show post" is not a field we forgot to surface; it is a
fact the product never observes.

## Decision

**The `done` footer's primary slot stays empty, and no disabled control is added
in its place.**

The canvas draws "Show post" disabled. Porting a permanently disabled button
would advertise a capability that does not exist and cannot be made to exist by
anything on this surface. `SHOW_RESULTS_LABEL` and `SHOW_POST_LABEL` stay exported
and unused: they are the vocabulary of record, so whoever builds this uses the
canvas's words rather than inventing a third phrasing, which is the reason the
vocabulary lives in `footerMode.ts` at all.

## Consequences

- The two labels have no importers, deliberately. The comment above them names
  this ADR so the next reader does not re-derive it.
- Nothing about the drawer changes. `done` keeps rendering Delete, Archive/Restore
  and the door-knocking note.
- Any future results work should add a body section per channel, matching phone
  banking's, and should not assume the footer slot is where it lands.

## The costed product question

### "Show results" — what would have to exist behind it

**Text and p2p — the only case where the data is already stored.** One aggregate
over `contact_interaction_text` grouped by `outreach_id` (`recipients`,
`responded`, `optedOut`), one additive optional block on `OutreachDetailSchema`,
one Results section in the drawer mirroring phone banking's. Small.

The blocker is not the build. `OutreachInboundSweep` documents its own ingestion
as unverified against real traffic: the inbound CDR `Direction` literal has never
been observed (no dev job has inbound traffic, so any non-outbound row is treated
as a reply), and the opt-out column's value vocabulary is guessed from a list of
falsy literals. Publishing a response rate off a feed that has never been
validated is worse than publishing nothing, because a candidate will act on it.
**The question to answer first is whether the reply/opt-out feed is trustworthy
enough to publish a rate from — that is the CDR-truth work (ENG-10740), not UI
work.** Assume the UI is days once that answer is yes.

**Robocall.** Needs a delivery-outcome ingestion that does not exist: the robocall
twin of `OutreachInboundSweep`, writing `answeredAt` / `voicemailLeftAt` onto the
already-materialized rows. Same shape as the text sweep, and it has to land
before any UI.

> **Correction ([ADR 0013](0013-robocall-delivery-outcomes-are-unbuilt.md)).**
> The outcome claim above is confirmed, but "from Peerly's call records" is
> wrong: there are none. Robocall does not go through Peerly — Peerly's
> integration is its P2P texting product and robocall outreaches never get a
> `projectId` — and no robocall vendor is integrated at all, so this is not
> weeks of sweep work behind a verification problem. It is blocked on settling
> which vendor delivers a robocall. 0013 also finds a live consequence this ADR
> understated: the shipped robocall activity-condition actions silently match
> zero people (`answered`, `voicemail_left`) or every recipient (`no_answer`).

**Door knocking.** The outcomes exist. What is missing is the join: the envelope
carries `doorKnockingRouteId`, and nothing maps a route back to its turf — the
same missing link that already prevents deep-linking "Continue knocking" to a
specific list and that keeps the two `archivedAt` flags in manual step. Fix the
mapping and the aggregation is ordinary.

**Social.** Out by spec, not by cost. Engagements were cut from v1.

### "Show post" — what would have to be captured, and when

There is no moment in the flow at which to capture it. That is the whole answer,
and it makes this a product decision rather than an engineering estimate. Two
options, orders of magnitude apart, with nothing in between:

- **Candidate-reported.** After generating copy, ask for the link: a nullable
  `postUrl` on `OutreachSocialAsset` (per-platform — one campaign fans out to as
  many as six), one PATCH, one input on `SocialAssetCard`. Days. The real question
  is what fraction of candidates would ever paste it, because a "Show post" button
  that is empty most of the time is worse than no button: it is the dead control
  this ADR exists to refuse, just intermittently.
- **Platform-integrated.** OAuth and publish for facebook, instagram, nextdoor, x,
  tiktok and youtube_shorts, storing each returned permalink. Most of those
  require app review. Quarters, and it turns social outreach from a copy generator
  into a publishing product.

## Not decided here

- **Whether a standalone results screen should exist at all.** Phone banking's
  results are in the drawer body, and that reads well. Someone should decide
  whether the canvas's separate destination is still wanted before it is built.
- **Whether robocall delivery outcomes are worth ingesting** for their own sake
  (contact history, activity conditions) independently of this footer slot.
  Audited in [ADR 0013](0013-robocall-delivery-outcomes-are-unbuilt.md): worth
  it, but blocked on a vendor decision before any of it is engineering work.

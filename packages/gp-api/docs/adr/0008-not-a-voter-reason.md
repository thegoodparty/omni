# 0008 — "Not a voter" is a reason we record, not a record we edit

Status: accepted

## Context

`not_a_voter` has been a `DoorKnockOutcome` since the question flow shipped, and
it derives a `not_a_voter` map status. Nothing else happens. The scope
guardrails in [door-knocking.md](../door-knocking.md) said so outright: _voter
removal (`not_a_voter` is stored, not acted on)_.

The confirmed V1 ladder asks a follow-up — **"What happened?"** — with two
answers, **Moved** and **Deceased**. The design prototype attaches removal
semantics to them: moved means "remove this address from that person's voter
record", deceased means "remove that person from your voter list", and the
resident then disappears from the household, taking the household with them if
nobody is left.

We are not building that. The voter data is L2-derived and refreshed from the
file; a destructive edit made at a door would be silently reverted by the next
refresh, or worse, survive it and become a permanent unexplained hole. Deleting
a person also deletes the evidence that anyone was ever told anything, which is
the one thing worth keeping from the conversation. And the campaign that heard
"she died last spring" has learned something about **its own list**, not about
the voter file every other campaign in the state reads.

So the question is not whether to remove anyone. It is where to put the reason,
what it should suppress, and how to take it back.

## Decision

**A fourth `ContactStatusField` member, `not_a_voter`, with values `moved` /
`deceased` / `cleared`. Nothing is deleted, unlinked, or written back to voter
data.** The consequence of the flag is suppression from future turf evaluation
and a marker on already-frozen routes — the same two mechanisms ADR 0007 built
for do-not-knock, reused rather than reinvented.

### One field, not two, and not a column on the interaction

The obvious alternative is a `notAVoterReason` column on
`contact_interaction_door_knock`, beside the outcome it qualifies. Three things
rule it out:

- **The outcome already ships without a reason.** The two-tap flow logs
  `not_a_voter` in two taps and walks on; the follow-up is optional. So the
  column would be nullable and meaningful only when `outcome = 'not_a_voter'` —
  a conditional the schema cannot express and every reader would have to
  re-check.
- **Corrections cannot reach it.** `recordIdempotent` upserts on
  `(organizationSlug, sourceId=clientKey)`. A canvasser who taps "Deceased" and
  fixes it a week later, from a different route, writes a _different_ row.
  "Which row is authoritative" then becomes a derivation rule, the way
  `latestAnswered` already is for support — a rule that exists because support
  answers are observations. This is not one.
- **Suppression needs a set, not a history.** The knock path asks one question:
  _who is flagged right now?_ `contact_current_status` answers it from the
  `(organization_slug, field, value)` index via `personIdsByFieldValue`, which
  is the same call do-not-knock already makes. Deriving that set from
  interaction rows means re-implementing latest-row-per-person in the critical
  path of the only paid call in the system.

The status model also brings `cleared`, an actor, a timestamp, cross-org
isolation, and an activity-feed row for free.

**One field rather than a `moved` field and a `deceased` field**, even though
the two are semantically different — moved is a claim about an address,
deceased is a claim about a person. Two arguments:

- They are mutually exclusive answers to one question asked at one door. A
  projection unique on `(org, personId, field)` makes the later answer replace
  the earlier one and records the replacement, which is exactly right. Two
  fields would let one person be simultaneously flagged moved and deceased,
  and every reader — the suppression query, the serve marker, the stop rollup —
  would need a rule for reconciling them.
- The semantic difference has nowhere to live anyway. `ContactCurrentStatus` is
  keyed by person; there is no address in it, and people_db carries exactly one
  residence per voter. An address-scoped fact would need a person×address table
  that nothing else in the system wants yet.

Unlike ADR 0007, this field is **not** recordable with no interaction behind
it. The question is asked as a follow-up, so an interaction always exists. That
is a real difference from do-not-knock, and it is not the reason for this
design — reversibility and the set query are.

### Both reasons suppress, and the reason "moved" suppresses the person

Deceased is unambiguous. Moved needs the argument.

The three options were: suppress the person everywhere, suppress them only at
this address, or record the reason and suppress nothing. The middle one is not
a real option — see above, there is no address in the projection — but more
importantly, **it is not a different set today.** Routing is driven by the one
residence people_db holds for a voter. Excluding a moved person from evaluation
removes exactly one door: the one they were reported to have left. There is no
second door to preserve.

Not suppressing at all was the other candidate, on the grounds that we already
have a live notion of a mover — `mayHaveMoved` is `!livePerson`, derived from
the residents join, and `PersonSheet` renders "May have moved since this route
was built". But that signal is the voter file catching up, which is exactly
what a canvasser standing at the door is ahead of. And "moved" will be the
common answer by a wide margin, so a design that suppresses only the dead is a
design that mostly does nothing. The candidate would keep being routed to a
door they already told us was wrong.

The live-enrichment path is deliberately untouched. A flagged person still
resolves residents, still shows `mayHaveMoved`, still carries whatever phone
numbers their live row has. Suppression is an evaluation-time decision about
future routes, not a redaction.

### Suppression is a conjunct, not an `idOverrides` entry

The exclusion travels in `excludePersonIds` and lands in
[voterDoorKnocking.service.ts](../../src/peopleDb/services/voterDoorKnocking.service.ts)
as an unconditional `AND` — the clause ADR 0007 built, unchanged. It is
emphatically not folded into `idOverrides`, which rides `buildVoterFiltersSql`
and contributes nothing when a turf's filter carries no voter-status selection.
That is the candidate who drew a polygon and applied no filters at all: the
most common case in the pilot, and the one where a filter-scoped exclusion
would silently do nothing.

The knock path reads both flagged sets and unions them into that one list,
deduped. They differ in what someone said at the door, not in what evaluation
has to do about it.

### Already-frozen routes carry the reason, not a status

A route built yesterday still contains a person flagged this morning, and the
paper list in someone's hand cannot change. Those targets are served with
`notAVoterReason` alongside `doNotKnock`, read live at serve time.

It is a reason rather than a boolean because the walk UI has something to say —
"moved away" and "deceased" call for very different tone at a door where the
rest of the household still lives. It is an optional key rather than a nullable
one because `cleared` is the absence of a reason, not a reason, and the phone
snapshots this payload offline where an older snapshot legitimately has no such
key.

It is **not** a new `DoorKnockStatus` member, for the reasons ADR 0007 already
gave: a knock status is derived from an interaction, and the enum's _order_ is
load-bearing in the rollup rank, the deck.gl color index, and the voter-pack
byte value. Flagged residents do drop out of the stop rollup, though, exactly
as do-not-knock residents do — `unknown` outranks everything, so one flagged
neighbor would otherwise report a fully-logged stop as still-to-knock.

### Reversibility: `cleared`, recorded

A mis-tapped **Deceased** is the worst mistake this feature can make, and it is
foreseeable — it sits one row away from **Moved** on a phone screen in the
rain. Posting `cleared` lifts it, and posting the other reason replaces it;
either way the transition is a row in `contact_status_event` with an actor and
a timestamp. Deleting the projection row instead would erase the answer to "who
un-flagged a dead person, and when" — a question that gets asked precisely when
it matters. `changeStatus` no-ops when `fromValue === toValue`, so clearing
someone who was never flagged writes nothing, given `cleared` as
`fallbackFromValue`.

### Its own endpoint, org-scoped by the stop target

`POST /v1/door-knocking/not-a-voter`, taking a `stopTargetId`. Same shape and
same reasoning as the do-not-knock write: the CRM's
`PATCH /v1/contacts/:personId/status` calls `assertProAccess` and the pilot has
no Pro gate, and resolving a stop target through route → turf → filter is a
strictly tighter authorization than a bare person id.

No `sourceId`. The idempotency key exists for replayed activity syncs; this is
a person pressing a button, `changeStatus` already no-ops on an unchanged
value, and a genuine correction has to be able to reach a value an earlier
visit set.

### Nothing derives it

No outcome writes this field, including `not_a_voter` itself. Logging the
outcome and answering the follow-up are two taps and two decisions, and the
second one suppresses a person from every future route — too much to infer from
the first. There is no backfill from historical `not_a_voter` outcomes either:
those were logged before the question existed, so their reason is genuinely
unknown.

## Consequences

- The CRM gets it for free: same table, same activity feed, same person view.
  `Record<ContactStatusField, …>` maps in contracts and in the webapp's
  `ActivityFeedEntry` fail to compile until they name the new field, which is
  the intended forcing function.
- Turf evaluation now costs two flagged-set reads instead of one, both bounded
  by the org's own flagged people and both outside the turf lock.
- A person who moves within the district and whose voter-file row eventually
  catches up stays suppressed for this org at their new address until someone
  clears the flag. That is the known cost of a person-keyed suppression, and it
  is bounded: org-scoped, reversible, and the person remains fully visible in
  Contacts. Address-qualified suppression is the upgrade path if a
  person×address status key ever exists.
- `contact_current_status.value` stays a plain text column, so the vocabulary
  is Zod-enforced at the write boundary only. `NotAVoterReasonSchema` is
  derived from the full enum by excluding `cleared`, so a value added to the
  Prisma enum shows up in the write vocabulary and has to be handled
  deliberately at the read sites.
- Adding the enum member is a one-line `ALTER TYPE ... ADD VALUE`. Removing one
  is not, so the vocabulary is worth getting right now.

## Not decided here

- **The walk UI.** The follow-up sheet, the marker treatment, whether a fully
  flagged household collapses, and what the printed sheet shows are a separate
  PR. This one only makes the API able to answer.
- **Surfacing it as a filter dimension in the CRM segment editor.** The storage
  supports it; the filter catalog is its own review surface.
- **Whether "deceased" should ever suppress across channels** (texts,
  robocalls). It plainly should, and it plainly is not a door-knocking
  decision — the other channels resolve their audiences through paths this ADR
  does not touch.

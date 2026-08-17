# 0009 — The per-resident activity feed rides the route payload

Status: accepted

## Context

The Aug 14 walkthrough put "an activity feed of previous outreach attempts" in
V1. Standing at a door, a canvasser needs to know whether this campaign has
been here before, when, and what happened — the difference between "hi, I'm
canvassing for…" and "hi, we spoke in June about the sidewalks."

The data has been read and thrown away since the serve path was written.
[doorKnockingServe.service.ts](../../src/doorKnocking/services/doorKnockingServe.service.ts)
already loads every door-knock interaction for the route's targets and
collapses the lot to a single effective `DoorKnockStatus` per person.
`RoutePayloadTarget` carries the verdict and none of the evidence.

So the question is not whether the data exists. It is where the wire boundary
goes: widen the route payload every walk already fetches, or add a per-person
endpoint the panel calls when it opens.

## Decision

**The feed ships on `RoutePayloadTarget.history`, newest first, capped
server-side at five rows per resident.**

### The measurement

A 100-stop route with 143 targets, realistic string lengths (people-db UUIDs,
seven-part unit keys, frozen path geometry), measured over gzip because that
is what the wire carries:

| per-target history | raw       | gzip    |
| ------------------ | --------- | ------- |
| none (before)      | 103.2 KB  | 24.4 KB |
| 3                  | 198.9 KB  | 35.5 KB |
| 5                  | 255.0 KB  | 42.9 KB |
| 20                 | 723.6 KB  | 99.8 KB |
| 40                 | 1350.5 KB | 174.2 KB |

Uncapped is the version worth rejecting outright. Per-person history is bounded
only by how much outreach the campaign has run — `ContactInteractionText` and
`ContactInteractionRobocall` take one row per recipient per launched outreach
(`outreachMaterialization.service.ts`), so a campaign texting weekly through a
cycle accumulates tens of rows per person, and a payload carrying all of them
grows past 7x. Nobody at a door reads forty entries.

Capped at five, the worst case — every single target having a full five rows —
is **+18.4 KB gzip**, and the realistic pilot case is far below it: a first
walk against a `contactsMade0` list has history on almost nobody, and at 25%
coverage the cost is **+4.7 KB**. The cap is what makes this bounded: a person
with two hundred CRM rows costs exactly the same bytes as one with five.

The per-person endpoint measures well on its own terms — one person's five
entries is 0.5 KB gzip, and it never pays for a resident whose sheet is never
opened. That is a real saving, and it is not the one that matters.

### Why the round trip loses

The endpoint has to answer one question: what happens when the request fails?
It fails at the moment of interaction, which is the moment a canvasser is
standing at a door, and the failure is not exotic — it is the ordinary
condition this whole product is shaped around. `print/` is a server component
with no `'use client'` anywhere in it, and `WalkView` links to it under the
comment "the offline story for v1: a canvasser walking out of signal takes
paper." The route is frozen and fetched once precisely so that walking it does
not depend on signal.

A canvasser who opened the walk at the car with four bars and is now three
houses into a dead zone has the whole route in the React Query cache. Under the
payload design the history is there with it. Under the endpoint design every
sheet they open shows a spinner that resolves to an error, on the one screen
they cannot skip. Retry does not help, because the thing they need has not been
fetched and cannot be. And it degrades exactly where the product is most
valuable — rural and low-coverage turf — while looking fine in every demo.

That asymmetry is the decision. 18 KB in the worst case, on a payload already
carrying 24 KB of frozen geometry and targets, buys a feature that works
everywhere the walk works. A round trip saves those bytes and puts a network
dependency on the doorstep.

### What the cap costs, and where the full history lives

Five is a product decision, not a byte-count one. The card answers "have we
been here, when, what happened", which the recent rows answer and the
sixth-oldest does not. The complete, paginated history already exists in the
CRM person view (`GET /v1/contact-engagement/:id/activities`), which is the
right surface for it: a desk, a scrollbar, and no one waiting at a door.

`ROUTE_TARGET_ACTIVITY_LIMIT` lives in `@goodparty_org/contracts` so the cap
the server applies and the cap the UI assumes cannot drift.

### Scoped to the resident, never the household

`history` hangs off `RoutePayloadTarget`, keyed by `personId` — deliberately
not off `RoutePayloadAddress`, where the household's other targets and
`otherResidents` live. Two registered voters behind one front door frequently
answered differently, and rolling their history together would show a
canvasser a refusal that belongs to the housemate who is not standing there.
The existing stop-level `knockStatus` rollup is a routing signal about a
building; this is a conversation about a person, and the two do not share a
key.

### The CRM's vocabulary, not a door-knocking copy of it

`RouteTargetActivitySchema` is a discriminated union over four of the CRM's own
`ConstituentActivity` members — `DOOR_KNOCK`, `TEXT`, `ROBOCALL`,
`STATUS_CHANGE` — imported from
[ContactActivity.schema.ts](../../../contracts/src/people/ContactActivity.schema.ts)
rather than redeclared. Same schemas means the webapp's existing
`ActivityFeedEntry` rows render the door's feed unchanged, and
`resolveContactStatusLabel` resolves `do_not_knock` and `not_a_voter` here
exactly as it does in Contacts. A `not_a_voter` flag that reads "Moved" in the
CRM and something else at the door is the failure this avoids, and it is the
kind of drift that only shows up in front of a candidate.

Two of the six variants are absent, both structurally:

- `POLL_INTERACTIONS` is elected-office only. Door knocking is Win-only
  (`v2Category: 'campaign'`), so the variant can never occur.
- `OUTREACH` — the deprecated `VoterOutreachActivity` rows — is keyed on
  `lalVoterId`. `door_knocking_stop_target` stores a people-db `personId`
  specifically so no raw LALVOTERID is frozen into a route, so the door has no
  key to join on. Those rows are the pre-`ContactInteraction` sunset path and
  no new writes target the model; the CRM person view still shows them, because
  it is handed a `lalVoterId` and the door is not.

### The cap is applied in SQL

`DoorKnockingActivityService` takes the top N per person with a `ROW_NUMBER()`
window over each source table, not by fetching and slicing. The route serve is
the read behind every walk open and every map open; reading an org's entire
text history for 150 stops' worth of people into Node heap to keep five rows
would make that read scale with how much outreach the campaign has run. Every
branch is served by that table's existing
`(organization_slug, person_id, occurred_at)` index — `contact_status_event`'s
equivalent is on `created_at`, which is its event time.

Each source contributes its own top N and the merge re-caps, which is exact
rather than approximate: the global top N is necessarily a subset of the union
of the per-source top Ns. Same-instant rows break on type then id, the tiebreak
`ContactEngagementService` already uses, so one person's history cannot order
one way in Contacts and another at the door.

## Consequences

- The 100-stop payload grows 24.4 KB → 42.9 KB gzip worst case, ~29 KB at
  realistic coverage. Route serve costs four more index-served queries, run in
  the same `Promise.all` as the three status reads already there.
- **A knock logged mid-walk does not appear in that resident's own feed until
  the route is served again.** `WalkView.patchPerson` writes the recorded
  `knockStatus` into the route query cache and nothing else, so the status
  everywhere else in the walk updates immediately while the feed keeps showing
  what the payload was served with. The gap is in the callback, not the cache:
  `RecordKnockForm` reports `onRecorded(personId, knockStatus)`, and
  `knockStatus` is the *derived* rollup, not the `outcome`/`supportAnswer`/
  `note`/`id` a `DOOR_KNOCK` row is made of. Closing this means widening that
  callback to carry the created interaction and appending it in `patchPerson` —
  a change to `RecordKnockForm` and `WalkView`, not to the card. Reconstructing
  a row from `knockStatus` alone is the wrong fix: it would print an outcome
  nobody chose, in a second vocabulary, that the next serve then silently
  rewrites.
- `history` is `.optional()` rather than required or `.default([])`. The
  server always sends the array, empty included, but nothing on this path
  enforces that at runtime in either direction: `ZodResponseInterceptor` is not
  registered globally and `DoorKnockingController` does not apply it, so the
  `@ResponseSchema(DoorKnockingRoutePayloadSchema)` on `serveRoute` is inert
  (the same inertness `websites.controller.ts` documents on its own handlers),
  and on the client `clientRequest` casts ofetch's JSON to the contract type
  without parsing it. `.default([])` therefore fills in nothing anywhere; it
  only widens the inferred type to a non-optional array, which is precisely the
  guarantee no code is left to make. A route snapshotted by the service worker
  before this shipped has no `history` key, so on a phone that is offline and
  cannot refetch, the non-optional type would hand a consumer `undefined` while
  telling the compiler it had an array. `.optional()` keeps
  `RouteTargetActivity[] | undefined` and makes the compiler force each call
  site to say what an absent feed renders as — the same argument that made
  `notAVoterReason` optional in ADR 0008.
- Adding a channel to the CRM feed does not automatically add it here; the
  union names its variants. That is deliberate — `OUTREACH` is exactly the
  variant that must not be added without a key to join on.
- The feed is ungated alongside the rest of the pilot. It reads the same rows
  `GET /v1/contact-engagement/:id/activities` serves, but through the route's
  own org scoping rather than that endpoint's, for the reason ADR 0007 gave
  about the CRM's status PATCH: a Pro gate on the door would mean a canvasser
  can log a knock and not see the one they logged last week.

## Not decided here

- **Paging the door's feed.** A "see full history" affordance from the sheet
  into the CRM person view is sensible and is a UI decision with its own
  surface. The cap is deliberately not a page-1 cursor: nothing about this
  contract promises the sixth row is reachable from here.
- **Notes in the feed.** The CRM excludes `ContactNote` rows from its feed
  (ENG-10780) and keeps them in a dedicated section. The door inherits that
  and does not relitigate it.
- **Whether a household-level view is ever wanted.** Plausibly useful for
  "somebody here already said no"; it is a different question from this one and
  needs a design that cannot be misread as the resident's own answer.

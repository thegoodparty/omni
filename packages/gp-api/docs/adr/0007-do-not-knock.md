# 0007 — Do-not-knock is an instruction, not an outcome

Status: accepted

## Context

A canvasser is told at the door: _don't come back_. Today there is nowhere to put that. The closest existing concepts are all observations of a single conversation:

- `DoorKnockOutcome.refused_to_engage` — this person did not want to talk **today**.
- `SupportStatusRollup.refused` — settable only as a manual override; the schema comment in [contactStatus.prisma](../../prisma/schema/contactStatus.prisma) is explicit that the derived rollup never produces it.
- `DoorKnockStatus.refused` — the map dot, derived from the outcome above.

None of them is an instruction that must outlive the conversation. A refusal is a fact about one visit; do-not-knock is a standing constraint on every future visit. They are also not correlated in the direction people assume: a supporter can ask not to be disturbed again, and someone who slams the door is often worth a second try from a different volunteer.

There is a second, sharper reason to keep them apart. Suppression has to work when nothing was logged at all — a neighbor says the resident is in hospice, a canvasser sees a hostile sign — and any design that reaches do-not-knock _through_ an interaction record cannot express that.

## Decision

**A new `ContactStatusField` member, `do_not_knock`, on the existing layered status model. No new tables.**

`ContactStatusEvent` and `ContactCurrentStatus` already generalize over `field`: an append-only log plus a current-state projection, unique on `(organizationSlug, personId, field)`, written in one transaction with `sourceId` idempotency. That is exactly the shape this needs, and it arrives with an audit trail, cross-org isolation, and an activity feed already wired.

### Vocabulary: `active` and `cleared`

Absence of a row means knockable, consistent with the rest of the layered model ("no override — use the derived value"). The derived value for this field is always `cleared`: nobody is born do-not-knock.

`cleared` exists as an explicit value rather than deleting the row, because **reversal has to be recorded**. A mis-tap on a phone in the rain is a foreseeable event, and "who lifted this, and when" is the kind of question that gets asked precisely when it matters. Deleting the projection row would erase the answer. `ContactStatusService.changeStatus` already no-ops when `fromValue === toValue`, so clearing a person who was never flagged writes nothing, provided callers pass `cleared` as `fallbackFromValue`.

### Nothing derives it

No interaction, outcome, or answer sets `do_not_knock`. In particular `refused_to_engage` does **not**, and there is no backfill from historical refusals. Inferring a standing instruction from a single bad conversation would silently shrink every future walk list on evidence the candidate never gave, and it is not recoverable after the fact — you cannot tell an inferred flag from a real one once it is written.

This is the whole reason it is a separate field rather than a `support_status` value: an override on `support_status` would then mean two different things, one describing the voter and one instructing the campaign.

### Org-scoped, never shared

The projection is keyed by `organizationSlug`, like every other status. A do-not-knock told to one campaign is not evidence about another, and sharing it across orgs is a data-sharing decision with legal weight that nobody has made. This also keeps it distinct from a TCPA opt-out, which is why `Opt In Status` deliberately has no `ContactStatusField` member at all: a texted STOP is a legal state on a channel, not a per-campaign preference about a doorstep.

### Suppression at evaluation, not at freeze

Turf evaluation excludes flagged people, so **future routes never contain them**. The exclusion is emitted as an unconditional `AND` conjunct, mirroring how `contactsMadeIdOverrides` is composed in [databricksVoterSql.util.ts](../../src/peopleDb/databricks/databricksVoterSql.util.ts) — deliberately _not_ the `idOverrides` slot, which is scoped inside the `voterStatus` clause and is silently dropped when a filter carries no voter-status selection. A suppression that disappears depending on an unrelated filter choice is worse than none, because it is invisible.

A turf that resolves to nobody already throws `BadRequestException`, so a fully-suppressed area fails loudly instead of freezing an empty route.

### Already-frozen routes carry a flag, not a status

A route built yesterday still contains a person flagged this morning. Those targets are served with a `doNotKnock` boolean, and the walk UI marks them and withholds the logging form.

This is deliberately **not** a new `DoorKnockStatus` member, for two reasons. A knock status is derived from an interaction (`deriveKnockStatus` takes only `{outcome, supportAnswer}`); do-not-knock comes from another table entirely and would have to be layered over the derivation rather than produced by it. And the status enum's _order_ is load-bearing in three independent places — the rollup rank, the deck.gl color array index, and the voter-pack byte value — so it is a poor place to express something that is not a status.

### Its own endpoint, not the CRM's status PATCH

The obvious move is to reuse `PATCH /v1/contacts/:personId/status`, which already writes this exact table. It is the wrong one: that handler calls `assertProAccess`, and the door-knocking pilot deliberately has no Pro gate. A candidate in the pilot would be able to knock a door and then get a 400 trying to honor what they were just told.

So do-not-knock gets `POST /v1/door-knocking/do-not-knock`, taking a `stopTargetId` rather than a bare `personId`. That authorizes the same way `recordInteraction` does — the target must sit on a route belonging to a turf in the caller's org — which is strictly tighter than a person-id path param, and it keeps the door-knocking surface's access rules in one place. Both endpoints converge on `ContactStatusService.changeStatus`, so the storage, the audit trail, and the activity feed stay shared.

The knock payload itself is unchanged. `RecordDoorKnockInteractionSchema` gates its answers on `outcome === 'answered'`, and do-not-knock must be recordable when there is no outcome worth logging.

`sourceId` is null on these writes, even though the source is `door_knock`. The idempotency key exists for replayed activity syncs; this is a person pressing a button, and `changeStatus` already no-ops when the value is unchanged, so a double-tap costs nothing and a genuine reversal is worth its own row.

## Consequences

- The CRM gets it for free: same table, same activity feed, same person view.
- `resolveContactStatusLabel` becomes a field-keyed lookup instead of a two-armed ternary. As written, it routes any unrecognized field to the support-status labels, which would render this field's values as raw strings in the feed.
- Adding the enum member is a one-line `ALTER TYPE ... ADD VALUE`. Removing one is not, so the vocabulary is worth getting right now.
- `updateContactStatus`'s field and fallback mapping is a pair of ternaries over the old two-member enum. It keeps working, because the CRM cannot send this field, but it is the place that would need editing if the CRM ever offers do-not-knock as an editable status.
- Suppression costs one extra query per turf evaluation (`personIdsByFieldValue`), bounded by the org's own flagged set, which is small by construction.

## Not decided here

- **Surfacing it in the CRM's filter builder** (a "do not knock" dimension in the segment editor). Sensible, and the storage supports it, but it is a filter-catalog change with its own review surface.
- **Volunteer-facing permissions.** Anyone who can log a knock can flag and clear. Whether a volunteer should be able to _clear_ another person's flag is a real question, deferred until volunteer roles exist.

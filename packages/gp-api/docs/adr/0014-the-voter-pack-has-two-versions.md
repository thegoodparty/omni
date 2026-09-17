# 0014 — The voter pack has two versions, and only one of them is on the wire

Status: accepted

## Context

The [exploration-map pack](../door-knocking.md#the-pack) is a binary the browser
mounts typed-array views over. Its manifest carries `version: 1`, a
`z.literal(1)` on both ends, and until now nothing has ever changed about the
format, so nobody has had to say what that number means.

Two pieces of work arrived at once and both need an answer.

**The contacts-made plane** (this PR) adds a dim. **The age re-cut** (the next
one) changes an existing dim's buckets: the pack's `age` values are the legacy
`18_25 / 25_35 / 35_50 / 50_plus`, whose highest boundary is 50, so there is
nowhere for the `age65Plus` saved-list filter to map and lists using it shade a
superset of who they will knock.

And a third, already recommended and not yet built: **a per-district pack
cache** ([`docs/perf/voter-pack-headroom.md`](../perf/voter-pack-headroom.md)),
keyed `(districtId, mirrorVersion)`, which is the only measured option that
takes the 23 s build to a few seconds. A cached buffer built before the age
re-cut has bucket boundaries the new code does not expect, and the proposed key
cannot tell.

## The question that was actually being asked

"Bump the version" reads as one action. It is two, and they have opposite
requirements.

|                                     | **Framing** changed                 | **Vocabulary** changed                              |
| ----------------------------------- | ----------------------------------- | --------------------------------------------------- |
| Example                             | a new array type, a layout rule     | age buckets re-cut, a dim added                      |
| An old client reading the new bytes | reads them **wrongly**              | reads them **correctly**, because it reads buckets from the manifest |
| So old clients must                 | **reject** the pack                 | **accept** the pack                                  |
| So a cache must                     | not serve across it                 | not serve across it                                  |

The manifest's `version` is the first column, and it does its job by being
`z.literal(1)`: raising it makes every deployed client reject the pack, which is
correct precisely when the alternative is silent misreads.

The age re-cut is the second column. It is invisible to a client, because
`filtersToDimSelections` matches saved-list filter keys against `dim.values`
read out of the manifest in hand — never against a hardcoded list. An old
client meeting a re-cut `age` dim finds no bucket for `age18_25`, adds **no
constraint** for it, and `unpreviewableFilterKeys` then names that filter in the
disclosure the UI already carries. It degrades to a shaded superset that says
out loud it is a superset — the pre-existing honest failure mode, not a new
one. Bumping `version` for it would take a deploy that needs no coordination and
turn it into one that breaks every open tab.

But a *cache* must still not serve across it, because a cached buffer is bytes
from the old vocabulary and the key `(districtId, mirrorVersion)` is blind to
which code built them.

## Decision

**Two version numbers, on two different axes, in two different places.**

1. **`version` in the manifest stays the framing version, and stays `1`.**
   Raise it only when a decoder written for the old framing would misread the
   new bytes. It is `z.literal` on purpose: its whole job is to make old clients
   refuse.

2. **`PACK_FORMAT_REVISION` is a server-side constant in `contracts`, and is
   not on the wire.** It names the vocabulary of the district-scoped dims.
   Increment it when a district dim's key or bucket list changes; the planned
   cache keys on `(districtId, mirrorVersion, PACK_FORMAT_REVISION)` and
   therefore misses every pre-change entry on the deploy that changes it. It
   stays off the wire because no client needs it: a client reads its buckets
   from the manifest, and a number it would only ever ignore is a number that
   will drift.

   It explicitly does **not** cover the per-organization planes
   (`canvassStatus`, `contactsMade`), which are rebuilt per request under any
   caching design and so can never be stale in a cached artifact.

3. **The manifest object schema drops `.strict()`.** Nested objects keep it.

Point 3 is the load-bearing one and is easy to skip past. The browser parses the
manifest with the schema that shipped in **its** bundle, so with a strict top
level, adding any manifest key at all is a change that breaks every tab open
across the deploy — `decodePack` throws and the map fails to load, with no
degradation available. Tolerance costs nothing: the `superRefine` that checks
core arrays, dim planes and `elementCount` against `counts` is what actually
keeps producer and consumer honest, and it is untouched. A versioned wire format
has to be additively extensible, and this is the change that makes it so.

## Consequences

- **The two changes this ADR was written for both ship without a client
  migration.** Adding `contactsMade` is a new dim an old client does not
  recognise, does not select on, and names in its disclosure. The age re-cut is
  the same. Neither touches `version`; the age re-cut increments
  `PACK_FORMAT_REVISION`.
- **The tolerance is only forward-looking.** Clients deployed before this change
  are still strict, so the *first* manifest key added after it is still a
  breaking change for whoever is mid-session on an old bundle. That is the
  reason the loosening ships in the earlier PR of the two rather than alongside
  the field that needs it.
- **`PACK_FORMAT_REVISION` currently has no consumer**, because the cache is not
  built. It is a constant with a doc comment and an ADR, and the alternative is
  discovering at cache-build time that the artifact needs a discriminator nobody
  has been maintaining. Keeping it correct costs one increment per vocabulary
  change; getting it wrong the first time costs a district's worth of packs
  shaded against buckets that no longer mean what they say.
- **A `version` bump remains available and remains blunt.** Nothing here makes
  the framing easier to change; it makes it clearer when that is the right tool.

## Not decided here

- **The pack cache itself.** Recommended, costed and unbuilt — see
  [`voter-pack-headroom.md`](../perf/voter-pack-headroom.md) option 1. This ADR
  only ensures its key can be correct when someone writes it.
- **Whether the manifest should eventually carry `PACK_FORMAT_REVISION`
  anyway**, as a debugging aid on a stored artifact. Point 3 makes that
  additively possible; nothing needs it yet.

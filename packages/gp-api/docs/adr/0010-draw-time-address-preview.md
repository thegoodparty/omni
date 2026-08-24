# 0010 — Street addresses at draw time, and the count that comes with them

Status: accepted

## Context

The draw step is where a candidate decides whether a shape is a reasonable
evening. It could already say how many doors the ring enclosed and roughly who
lived there. It could not say **which houses**, and the walkthrough's words were
"I can't see a list of the households that are in my list."

That is not an oversight in the UI. The map is drawn from the voter pack, which
is `positions`, two index arrays and one byte per person per dimension. It
carries **no address at all**. An address is read at knock time by
`voterDoorKnocking.evaluate` and frozen onto a route stop — and the knock is a
billed, irreversible Geoapify call. So the one artifact that knows the street
names is the one that only exists after the candidate has committed.

The draw step's roster (PR #1325) shipped anonymous rows and a line saying
addresses arrive with the route. The same PR **considered a preview endpoint and
rejected it**, for a reason that was correct: an endpoint running the knock's
evaluation returns the *exact* in-ring audience, while the bar above the roster
reports the pack's *superset* — filters the pack cannot shade do not narrow it,
knock time additionally applies activity conditions, support status and
prior-contact clauses the pack does not carry, and then drops do-not-knock and
not-a-voter residents. Printing both at the moment of commitment is the
two-denominator failure this feature has already shipped once and written a rule
against.

The product owner has since required the addresses. So the rejected option is
being built, and the thing it was rejected for has to be solved rather than
rediscovered.

## Decision

**`POST /v1/door-knocking/address-preview` runs the knock's evaluation without
the vendor call, and its counts replace the pack's estimate on the draw step
rather than joining them.**

### One quantity, one number

The pack's estimate is not shown beside the preview. Once a preview exists for
the ring on screen, `stops`, `doors` and `people` in the stats bar, the walk-time
estimate, the 100/150 cap warnings, the Continue button's own door figure and
the confirm step's summary all read the preview's numbers. The estimate becomes
what it always was on the way to them: the instant answer that holds the screen
until the exact one arrives.

Two hedges go with it, and both would have been actively wrong to keep:

- The `unpreviewableDisclosureLabels` line ("the map can't shade by 65+ yet, so
  these counts include people that filter will exclude") explains a shortfall the
  exact counts do not have. `resolveSavedFilterForQuery` applies that filter.
- The party mix is a breakdown of the *superset's* people. Left standing, its
  slices would no longer sum to the people figure directly above them.

**The two do not merely differ in precision — they count different things**,
which is what makes blending them impossible rather than merely untidy. The
pack's household key groups at `AddressLine` (a building); `evaluate` and the
freeze use `DOOR_KNOCKING_UNIT_KEY_COLUMNS`, which carries the apartment. `Apt 1`
and `Apt 2` are one household to the pack and two doors to the route. A design
that showed both, or that hedged the exact one, would have printed a number that
matched neither the estimate nor the thing bought.

The rejected alternative here was **the preview as a pure listing**: show the
addresses, report no count of its own, leave the pack's hedged number as the only
figure. It preserves the invariant on a technicality and breaks it in the
reading, because a list of 41 addresses under a bar saying 57 doors is two
denominators — the candidate just has to do the counting themselves. PR #1325
already treated a roster whose length disagreed with the stat above it as a
failure mode worth testing against, and that judgement does not change because
the disagreement is now the pack's fault rather than the roster's.

The preview also cannot hedge on suppression the way the surfaces around it do:
excluded residents are gone from these numbers, so the copy says so ("people
marked do-not-knock or 'not a voter' are already out") rather than repeating the
rail's "you'll knock fewer doors than this."

Everything that reports a pre-route count and *cannot* see a preview is
unchanged. The landing rail's "About N" and `TurfDetailsSheet`'s pre-route Doors
and People still hedge: they describe a saved list or a district, not the shape
being drawn, and no exact count is available to them.

### The count moves under the candidate, and that is the trade

Making the exact count authoritative means the number changes when the preview
lands — the candidate reads 57 doors, presses for addresses, and the bar settles
at 41. That is a real cost and it is the honest one: 41 is the number of doors
they will walk. The alternative is a step that reports a figure it knows to be
wrong at the one moment the figure is being committed to.

What it must **not** do is move while drawing, which is the cadence decision
below.

### Cost and cadence: an explicit request, and staleness rather than a refetch

The ring changes with every vertex placed and every vertex dragged. A round trip
per change would put a people-db scan on a gesture.

- **The panel is opt-in.** Drawing issues no request at all. The candidate
  presses "See the addresses", which is the only thing that ever starts one. This
  inherits PR #1325's rule that a shut panel pays nothing; what changes is that
  the cost is now a database scan rather than a pass over an array already in
  memory, so the rule matters more.
- **Moving a vertex makes the answer stale — it does not refetch.** The webapp
  holds `previewRing`, the ring that was on screen when the request was made, and
  compares it by reference to the live ring. When they diverge the list is
  withdrawn, the panel says the boundary changed, the counts fall back to the
  pack in the same render, and asking again is another press.
- **Debouncing was rejected.** A debounce still bills every shape the candidate
  passes *through* on the way to the one they mean, and it makes the count on
  screen a moving target during a gesture — reintroducing, as a timing artifact,
  exactly the instability the pack's instant feedback exists to avoid. An
  explicit press is both cheaper and easier to reason about: one press, one scan.
- **The query is keyed `[shape, filters]` with `staleTime: Infinity`.** Those two
  inputs are the entire input to the answer, so a preview for them cannot go
  stale while the candidate is still looking at that shape. Continue to confirm
  and Back returns to the same ring and is served from cache rather than billing a
  second scan.

`enabled` additionally gates the query on the draw step. The ring outlives that
step — Back to the filters keeps it and so does Continue — so a panel left open
and backed out of would otherwise refetch behind a list nobody can see, on the
step whose pills recolor the dots on every tap.

### It runs the knock's resolution, not a cheaper one

`DoorKnockingPreviewService` deliberately repeats what `DoorKnockingKnockService`
does before it calls Geoapify:

- `resolveEligibleDistrictId` server-side, like the pack and every turf read. An
  org with no resolvable district gets the same 400 it gets everywhere else.
- `resolveSavedFilterForQuery` on the **draft** filters.
  `convertVoterFileFilterToFilters` alone drops activity conditions, support
  status, contacts-made and the voter-likelihood overrides — so anything cheaper
  would preview an audience the list would not knock, which is the exact drift
  this endpoint exists to close. It also carries the Win-only gates, so an
  elected-office org gets the same rejection here as at knock time.
- ADR 0007 and ADR 0008 exclusions, deduped into one `excludePersonIds` list
  exactly as the knock builds it.
- `polygonBbox` to bound the scan, then `pointInPolygon` as the decider, in the
  same order for the same reason.

A door whose every resident is flagged therefore does not appear. That is not the
preview hiding a house — it is the route not containing it, and a preview that
listed it would be advertising a stop the purchased route would not have.

The one behavioural difference from the knock is what an empty shape does. The
knock raises a 400, because a turf is being committed. A shape still being drawn
is allowed to enclose nobody: the preview returns zeros, and the draw step
already says "No doors in this area". Erroring would turn ordinary drawing into a
failure.

`buildStops` is not shared. It throws on an empty or oversized turf and builds
the vendor's waypoint payload — behaviour a shape being drawn must not have — so
the grouping is written out beside it (WET) with a comment naming what it
mirrors.

### The cap is on what is listed, not on what is counted

`MAX_STOPS` (150) is now exported from the knock service and used here, so one
constant blocks the save and bounds the listing. `stops` reports the true total;
`locations` stops at 150. The panel prints "Showing the first N of M stops" off
the difference. Whole locations only — a half-listed building would report fewer
doors than it has, which is the one thing a door list must not do.

This matters because the cap is a **block**. A shape over 150 stops cannot be
saved, and it was previously the pack's superset that decided whether it was
over — so a shape the route would have accepted could be refused on an
overcount. Once a preview is live, the number that blocks is the number the route
would produce.

### What is on the wire, and what is deliberately not

`DoorKnockingPreviewDoor` is `{ address, people }`. No names, no ages, no party,
no phones, no person ids. The draw step is answering "which houses is this?", and
a candidate deciding where to walk does not need a roster of who lives there
before committing to anything. The route payload and `PersonSheet` remain the
only surfaces that identify a resident, and nothing here reaches paper — the PDF
and the walk sheet leave the building and stop being access-controlled, and they
still exist only after a route does.

`address` is rendered by `renderUnitAddress`, extracted from
`doorKnockingServe.service.ts` into `utils/unitAddress.util.ts` and now shared by
both. The two surfaces name the same physical door; a candidate who previews
"1200 W Elm St Apt 3B" and then walks a list spelling it differently has been
given two addresses for one house.

### Pro-gated, and a POST

The route calls `assertProAccess` with the rest of `/v1/door-knocking`. It is a
read of voter data, and the only two ungated routes in that controller are
`do-not-knock` and `not-a-voter`, which are instructions about a door rather than
reads of an audience.

It is a `POST` because the polygon and the filter draft are a body, not a query
string. Nothing is written, nothing is frozen and no vendor credit is spent.

## Consequences

- Drawing costs nothing. Each press of "See the addresses" is one people-db
  evaluation over the ring's bbox, the same query shape the knock already runs.
  Repeat presses on an unchanged shape are served from the React Query cache.
- **The draw step's counts change when a preview lands**, by design. Any surface
  added to that step must take its numbers from the same place
  (`addressPreview ?? turfStats`) or it will contradict the bar beside it.
- The 150-stop block is evaluated against the exact stop count once a preview
  exists, and against the pack's estimate otherwise. Those can disagree; the
  exact one is the one the route would produce.
- A fully flagged door is absent from the preview, so it cannot be a stop in the
  route either. Consistent with `stopIsKnockable` and `rollupStopStatus`, which
  describe a door that has *become* unknockable after freezing.
- The endpoint is tested through the routes harness
  (`doorKnocking.routes.test.ts`), including that it spends no vendor credit and
  freezes nothing, and it is in the Pro-gate table's route list.
- `packages/gp-webapp/.../AGENTS.md` no longer records this endpoint as rejected.
  The note now records why it was rejected, what changed, and where to read the
  reasoning before rejecting it again.

## Not decided here

- **Showing the preview's addresses anywhere but the draw step.**
  `TurfDetailsSheet` describes a saved-but-unknocked list and would have the same
  question asked of it. It is a different surface with a different cost profile
  (a saved list has a filter id and a stored polygon, so it could be cached
  server-side), and it keeps its "About N" hedging until someone designs that.
- **Tapping an address to highlight its dot.** Wanted, and blocked on the panel
  covering the map band it would highlight into, plus a new layer inside the
  maplibre/deck.gl chunk the create flow is deliberately outside of.
- **Caching a preview server-side.** The client cache covers the one repeat that
  matters (Back from confirm). A shared cache keyed on shape-and-filters would
  need an invalidation story against do-not-knock and not-a-voter writes, which
  is more machinery than the observed press rate justifies.

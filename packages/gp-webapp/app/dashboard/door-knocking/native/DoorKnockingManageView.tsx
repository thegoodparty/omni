'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DoorKnockingTurf, DoorKnockStatus } from '@goodparty_org/contracts'
import { turfsQueryOptions } from './turfQueries'
import TurfList from './TurfList'
import TurfLegend from './TurfLegend'

// The audience the map is shading, resolved once by the orchestrator so the
// heading, the count line, the legend chips and the dots cannot each guess at
// it separately. The three booleans are a tri-state and not independent:
// `ready` is a settled scope, `pending` is one that can still arrive, and
// `unavailable` is a settled nothing (the list's filters failed to load, or it
// was deleted in the CRM). Exactly one of them is true whenever `turf` is set.
export interface MapScope {
  // The selected list, or null for the whole district.
  turf: DoorKnockingTurf | null
  // The live name off the turfs query, not the snapshot's — a rename from the
  // details drawer must not leave the heading showing the old one.
  name: string | null
  // People in the scope, or null while the pack has yet to answer at all. The
  // count line renders only when this is a number; the heading always renders,
  // because it names the scope the candidate picked rather than its size.
  people: number | null
  ready: boolean
  pending: boolean
  unavailable: boolean
  // Selections the pack has no bucket for, so the count above is a superset.
  // Already resolved to display labels by `unpreviewableDisclosureLabels`.
  unpreviewableLabels: string[]
}

// SEAM — the manage surface (Wave 1B).
//
// This surface owns: the saved-list rail, the district/list legend, and how
// the two are laid out at every width — a bottom sheet over a full-bleed map
// below `lg`, and a floating inset card over the same full-bleed map above it.
// It owns `railOpen` outright, because nothing outside it can see that state —
// the orchestrator unmounts this whole surface for a create flow and for a
// walk, which is what resets it.
//
// The orchestrator owns: every piece of state the MAP also reads. The
// selection, the hidden set and the status filter all recolor or mask dots, so
// they arrive as props and change through the callbacks below rather than
// being held here. The couplings between them (selecting a hidden list reveals
// it; hiding the selected list deselects it) are the orchestrator's too, so
// this surface reports the gesture and never the consequence.
export interface DoorKnockingManageViewProps {
  scope: MapScope
  // Person-level counts per status over the scope, for the legend. Deliberately
  // not narrowed by `statusFilter` — a legend that narrowed with its own chip
  // would zero the other six counts and leave nothing to press back.
  statusCounts: Partial<Record<DoorKnockStatus, number>>
  statusFilter: Set<DoorKnockStatus>
  // Which outlines the map is not drawing. Display state, not a property of
  // the turf.
  hiddenTurfIds: Set<number>
  onToggleStatus: (status: DoorKnockStatus) => void
  // A row was tapped. Whether that selects, deselects or reveals is the
  // orchestrator's call, since all three move map state.
  onSelectTurf: (turf: DoorKnockingTurf) => void
  onClearSelection: () => void
  onToggleTurfVisibility: (turf: DoorKnockingTurf) => void
  onShowDetails: (turf: DoorKnockingTurf) => void
  // Knock is idempotent server-side; the orchestrator decides between opening
  // an existing route and confirming a new one.
  onKnockTurf: (turf: DoorKnockingTurf) => void
  onDeletedTurf: (turf: DoorKnockingTurf) => void
  // The empty rail's Create list button was pressed. The create flow is the
  // orchestrator's — it replaces this whole surface — so this reports the
  // gesture like every other callback here. Optional, and the rail falls back
  // to pointing at the header's Create list button when it is absent: the
  // orchestrator's own wiring is a separate change, and an empty state that
  // names the button it cannot press is what this already did.
  onCreateList?: () => void
}

export default function DoorKnockingManageView({
  scope,
  statusCounts,
  statusFilter,
  hiddenTurfIds,
  onToggleStatus,
  onSelectTurf,
  onClearSelection,
  onToggleTurfVisibility,
  onShowDetails,
  onKnockTurf,
  onDeletedTurf,
  onCreateList,
}: DoorKnockingManageViewProps) {
  // Below lg the rail is a bottom sheet over a full-bleed map, and this is
  // whether it is pulled up. Purely a class switch, never a mount: the rail's
  // content renders at every width, so the desktop two-pane column is
  // unaffected by it and nothing has to read the viewport to decide what to
  // render (no matchMedia, no hydration mismatch).
  const [railOpen, setRailOpen] = useState(false)
  // Same query the rail's rows read, so React Query serves it from cache.
  const turfsQuery = useQuery(turfsQueryOptions)
  // Active lists only, so the closed handle agrees with the `Saved lists (N)`
  // heading it opens onto rather than counting the archive into it.
  const savedListCount = (turfsQuery.data ?? []).filter(
    (turf) => !turf.archivedAt,
  ).length

  return (
    // The map is full-bleed at every width and the rail floats over it — the
    // canvas's desktop treatment, and the same shape the phone already had.
    //
    // Above `lg` it is an inset card: the rail used to be `w-96 shrink-0` in
    // the page's flex row, which took a fixed 384px column out of the map on
    // the widest screens, where the map is most of what the tool is. Inset, it
    // costs the map only what it covers, and the map keeps its own edges.
    //
    // Below `lg` it stays the bottom sheet, on the same breakpoint PersonSheet
    // switches on. It can't simply be hidden there — it holds the saved lists,
    // the legend and the scope the map is showing — but a 384px column beside
    // a 390px viewport left the map about six pixels wide. Peeked it is one tap
    // from open, and open it stops well short of the top so pressing a status
    // chip still recolors dots the canvasser can see.
    <aside className="absolute inset-x-0 bottom-0 z-20 flex max-h-[60dvh] flex-col overflow-hidden rounded-t-xl border-t border-border bg-background shadow-lg lg:inset-y-4 lg:left-auto lg:right-4 lg:max-h-none lg:w-96 lg:max-w-[40vw] lg:rounded-2xl lg:border lg:bg-card lg:shadow-md">
      <button
        type="button"
        aria-expanded={railOpen}
        aria-controls="door-knocking-rail"
        // Deliberately not `items-center`: globals.css carries an unlayered
        // legacy rule (`button.flex.items-center:not([data-slot])`) that
        // pins display:flex and flex-direction:row, which outranks any
        // layered utility — the pair would leave this handle laid out in a
        // row and, worse, still displayed at lg. Centering comes off the
        // children instead.
        className="flex shrink-0 flex-col gap-1.5 px-4 py-2.5 lg:hidden"
        onClick={() => setRailOpen((open) => !open)}
      >
        {/* The grab handle the create flow's drag-down sheet already uses,
            so the two sheets read as the same object. */}
        <span className="mx-auto h-1.5 w-12 rounded-full bg-muted" />
        <span className="text-center text-sm font-medium">
          {railOpen
            ? 'Hide lists and legend'
            : `Lists and legend${savedListCount > 0 ? ` · ${savedListCount}` : ''}`}
        </span>
      </button>
      <div
        id="door-knocking-rail"
        className={`min-h-0 flex-1 flex-col overflow-hidden lg:flex ${
          railOpen ? 'flex' : 'hidden'
        }`}
      >
        {/* Only the lists scroll. The scope and its legend are pinned under
            them, per the canvas: they describe what the map is currently
            shading, so scrolling a long rail must not take the reading of the
            dots off screen with it. */}
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 pt-0 lg:pt-4">
          <TurfList
            selectedTurfId={scope.turf?.id ?? null}
            hiddenTurfIds={hiddenTurfIds}
            onFocusTurf={onSelectTurf}
            onToggleTurfVisibility={onToggleTurfVisibility}
            onShowDetails={onShowDetails}
            onKnockTurf={onKnockTurf}
            onDeletedTurf={onDeletedTurf}
            onCreateList={onCreateList}
          />
        </div>
        <section className="flex shrink-0 flex-col gap-2 border-t border-border p-4">
          <div>
            <h2 className="text-sm font-semibold">
              {scope.name ?? 'District voters'}
            </h2>
            {scope.people !== null && (
              <p
                className={`text-xs ${
                  scope.unavailable
                    ? 'text-destructive'
                    : 'text-muted-foreground'
                }`}
              >
                {/* The heading names the selected list in all three states —
                    it is the scope the candidate picked, not a claim about
                    its size. This line is where the claim lives, so it is the
                    line that has to admit to not having one. The pack is
                    rooftop-geocoded rows only (MAPPABLE_ONLY, >90% of the
                    file), so the district figure is not its full registration
                    total and shouldn't read as though it were — a candidate
                    comparing it against an official count needs to know why
                    it's short. */}
                {!scope.turf
                  ? `${scope.people.toLocaleString()} voters in your district with a mapped address`
                  : scope.pending
                    ? 'Counting the voters in this list…'
                    : scope.unavailable
                      ? 'This list’s filters could not be loaded, so its voters can’t be counted here and none are shaded on the map. Refresh to try again — the list still targets them when you knock.'
                      : `About ${scope.people.toLocaleString()} voters in this list`}
                {/* Reachable in all three states: an unresolved scope is
                    exactly the one a candidate needs a way out of. */}
                {scope.turf && (
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={onClearSelection}
                  >
                    Show all
                  </button>
                )}
              </p>
            )}
            {/* "About", not a hedge on the arithmetic: the count is exact for
                what the pack can compute, and a superset of who gets knocked.
                The gap is the PREVIEW's, never the filter's — a key the pack
                has no bucket for adds no entry to its dim at all, so a 65+
                list shades every age, while gp-api's own conversion bounds it
                at `{ gte: 65 }` and knocks exactly who was asked for. Knock
                time also applies the list's activity conditions, support
                status and prior-contact clauses, none of which the pack
                carries, then drops do-not-knock and not-a-voter residents.
                So the copy says the map can't show the filter — never that
                the filter isn't applied, which would read as targeting
                silently failing and is the worse misunderstanding. */}
            {scope.turf && scope.ready && (
              <p className="text-xs text-muted-foreground">
                About, because the map can&rsquo;t show every filter this list
                applies, and knocking also skips anyone marked do-not-knock or
                &ldquo;not a voter&rdquo; — so you&rsquo;ll walk fewer doors
                than this.
              </p>
            )}
            {/* The draw step's own sentence, from the same helper, so the
                filter isn't named one way while drawing and another here. */}
            {scope.turf &&
              scope.ready &&
              scope.unpreviewableLabels.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  The map can&rsquo;t shade by{' '}
                  {scope.unpreviewableLabels.join(', ')} yet, so these counts
                  include people that filter will exclude. Your saved list still
                  applies it when you knock.
                </p>
              )}
          </div>
          <TurfLegend
            statusCounts={statusCounts}
            statusFilter={statusFilter}
            onToggleStatus={onToggleStatus}
            ready={scope.ready}
            pending={scope.pending}
          />
        </section>
      </div>
    </aside>
  )
}

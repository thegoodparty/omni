'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@styleguide'
import { routeQueryOptions } from './turfQueries'
import { rollupStopStatus, stopIsKnockable } from './statusPresentation'
import type { LiveLocation } from './useLiveLocation'
import type { RoutePin } from './VoterMapCanvas'
import { useSheetControlsOffset, useSheetSnap } from './useSheetSnap'
import WalkView from './WalkView'

// A stop the canvasser asked to open, from the map rather than from the list.
// A token and not a bare stop id: closing the sheet leaves this state
// untouched, so the same pin tapped twice would otherwise be inert the second
// time.
export interface OpenStopRequest {
  stopId: number
  token: number
}

// The walk surface's half of the shared map, as a hook the orchestrator calls
// at the top level. The map belongs to the page — all three modes render into
// it — so what the walk contributes is pins, a path, and the tap that turns a
// pin back into a door.
//
// Everything here is per-walk and resets with `reset()` on the way out: a pin
// tapped on the way out would reopen its sheet on the next walk, and the coach
// mark is per-walk because each one starts on an unfamiliar route.
export const useWalkMapSession = (walkTurf: { id: number } | null) => {
  const routeQuery = useQuery({
    // Same key WalkView reads, so React Query serves one fetch to both.
    ...routeQueryOptions(walkTurf?.id ?? 0),
    enabled: walkTurf !== null,
  })
  const [openStopRequest, setOpenStopRequest] =
    useState<OpenStopRequest | null>(null)
  // Which stop the walk is on. It lives here, beside the tapped pin, because
  // the two are the same conversation in opposite directions — a pin tap
  // becomes a door the list opens, and whatever the list opens becomes the pin
  // the map rings — and because the canvas is what draws it, which is the
  // orchestrator's rule for where state goes. It used to be `WalkView`'s own,
  // which is why nothing was drawn on the map: the list could not tell the
  // canvas anything without a prop on the frozen seam.
  //
  // The walk is still the only writer. `WalkView` reports the stop it just
  // opened (a row tap, a pin tap, or auto-advance) and this holds it; nothing
  // here decides which stop that should be, because only the list knows what
  // the sheet is offering.
  const [selectedStopId, setSelectedStopId] = useState<number | null>(null)
  // The walk's first-run coach mark. It names the gesture the walk map exists
  // for, and it is dismissed by that gesture — nothing else on the map has
  // anything to teach here.
  const [hintDismissed, setHintDismissed] = useState(false)

  // Pins derive color from the route query cache, which recording a knock
  // patches — so the map pin recolors the moment a door is logged. The status
  // and the knockability are two answers to two questions, and the pin needs
  // both: a fully flagged stop rolls up over an empty list to the same
  // `unknown` grey as one nobody has been to, so the status alone would send a
  // canvasser to a door ADR 0007 or 0008 already told them to skip.
  const routePins = useMemo<RoutePin[]>(
    () =>
      walkTurf && routeQuery.data
        ? routeQuery.data.stops.map((stop) => ({
            stopId: stop.id,
            seq: stop.seq,
            lat: stop.lat,
            lng: stop.lng,
            status: rollupStopStatus(stop),
            knockable: stopIsKnockable(stop),
          }))
        : [],
    [walkTurf, routeQuery.data],
  )

  return {
    routePins,
    routeLoop: routeQuery.data?.route.loop ?? false,
    routeGeometry: walkTurf ? (routeQuery.data?.pathGeometry ?? null) : null,
    // Whether the walk's own route is still hydrating. The map region's
    // MapLoader reads this to keep the "Loading your route" spinner up
    // through both waits — the pack AND this route — so a walk built
    // fresh off Build route (pack already warm, only the route to fetch)
    // looks the same as a walk resumed off "Continue knocking" (both to
    // fetch). Same walkview end-state either way, so the loading UX has
    // to match too.
    routePending: Boolean(walkTurf) && routeQuery.isPending,
    // What the session reports on the way out, for the funnel event.
    stopCount: routeQuery.data?.route.stopCount ?? 0,
    openStopRequest,
    selectedStopId,
    // Takes a stop and never null, so the only thing that can un-mark a stop is
    // `reset()` on the way out of the walk. That is the list's rule made
    // structural: the mark outlives the sheet, because the door just worked is
    // the one worth keeping, and a mark that cleared on close would leave a
    // fifty-pin map saying nothing about where in the street the walk had got.
    selectStop: (stopId: number) => setSelectedStopId(stopId),
    // A tap does NOT mark the pin here. It becomes a request the walk acts on,
    // and the walk marks whatever it actually opened — a request for a stop the
    // served payload doesn't carry is dropped there, and marking it here would
    // ring a pin whose door never came up.
    onPinTap: (pin: { stopId: number }) => {
      setOpenStopRequest((current) => ({
        stopId: pin.stopId,
        token: (current?.token ?? 0) + 1,
      }))
      setHintDismissed(true)
    },
    hintVisible: Boolean(walkTurf) && routePins.length > 0 && !hintDismissed,
    reset: () => {
      setOpenStopRequest(null)
      setSelectedStopId(null)
      setHintDismissed(false)
    },
  }
}

// The prototype's walk hint, in the prototype's words. It sits at the bottom of
// the map band, which in walk mode is the whole width of a shell already
// stacked `flex-col` with the list below — the sub-lg rail sheet that would
// otherwise cover it belongs to the landing map and is unmounted for the length
// of a walk.
//
// `pointer-events-none`, so unlike the draw step's full-inset dismiss button it
// can never swallow the tap it is asking for — there is no stray-vertex problem
// to solve here, and eating the first pin tap would make the hint the bug. It
// is dismissed by the gesture it teaches instead.
export const WalkMapHint = ({ visible }: { visible: boolean }) => {
  if (!visible) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-4">
      <p className="rounded-full border border-border bg-background/95 px-4 py-2 text-sm font-medium shadow-sm">
        Tap a pin to log the door.
      </p>
    </div>
  )
}

// SEAM — the walk experience (Wave 1B).
//
// This surface owns: the stop list, the door sheet, the knock form, and which
// door is open — including the per-resident tabs and the bottom-drawer /
// right-sheet split the canvas asks for. A door has exactly one way to be
// logged and it is inside here, which is why a map tap arrives as a REQUEST
// (`openStopRequest`) rather than as the page opening a sheet of its own.
//
// The orchestrator owns: the map, the walk session (its funnel events and the
// turf being walked), and the way out. It knows nothing about which resident is
// on screen.
export interface WalkSurfaceProps {
  turfId: number
  // The name in the sheet's own header. The walk is a sheet over a full-bleed
  // map now, so the list being walked is named on the sheet rather than in the
  // page's title row — which is where the design puts it, and which is what
  // makes the header readable at the `peek` snap where nothing else renders.
  turfName: string
  // The X beside that name. The same exit the page's own chrome offers, so
  // there is one way out of a walk and not two that could end it differently.
  onExit: () => void
  // `Move to archive`, the one button under the stop list. The write is the
  // orchestrator's because it outlives the walk it shelves (`useWalkArchive`),
  // and because leaving is the orchestrator's gesture — this surface only knows
  // that the button was pressed.
  //
  // Optional as of ENG-11055: the volunteer walk has no archive affordance at
  // all — `useWalkArchive` is manager-only, and a volunteer's turf is never
  // theirs to shelve — so the button renders only where a handler is given
  // rather than every caller having to hand in a no-op. This is a deliberate
  // seam extension, not a loosening of the contract: the candidate/manager
  // orchestrator still passes both, and `WalkView` still renders the same
  // button for it byte-for-byte.
  onMoveToArchive?: () => void
  archivePending?: boolean
  // How far up the map this sheet reaches, so the zoom cluster can clear it.
  // Only the sheet knows, and only at its current snap.
  onMapControlsOffsetChange: (offsetPx: number | null) => void
  openStopRequest: OpenStopRequest | null
  // Which stop is marked. Both directions of it cross this seam, because the
  // list and the map each draw it and only one of them is behind here: the
  // walk reports the stop it opened through `onSelectStop`, and reads the
  // answer back off `selectedStopId` rather than keeping a copy — one value,
  // so the ringed pin and the marked row cannot come apart.
  selectedStopId: number | null
  onSelectStop: (stopId: number) => void
  // "My live location" — the READING only, now that the switch is the map
  // cluster's third button where the design puts it. The watch is the
  // orchestrator's either way (the map draws the dot and the canvas outlives
  // the walk), so what crosses is the one part of it a map control cannot
  // report: a permission that was refused, or a fix too coarse to trust.
  liveLocation: LiveLocation
  // Lets the page refetch the voter pack after the walk: the landing map's
  // statuses are baked into the cached pack, so new knocks are invisible there
  // until it reloads.
  onKnockRecorded: () => void
}

export default function WalkSurface({
  turfId,
  turfName,
  onExit,
  onMoveToArchive,
  archivePending,
  onMapControlsOffsetChange,
  openStopRequest,
  selectedStopId,
  onSelectStop,
  liveLocation,
  onKnockRecorded,
}: WalkSurfaceProps) {
  // The same three snaps and the same grip the manage rail uses, because they
  // are the same sheet at two moments of one job: a canvasser who learned to
  // drag it open on the list of routes has learned it here.
  const { snap, cycle, gripHandlers, heightClass, sheetRef } = useSheetSnap()
  useSheetControlsOffset(sheetRef, snap, onMapControlsOffsetChange, undefined)

  return (
    <aside
      ref={sheetRef}
      data-snap={snap}
      // Over the map at every width, unlike the manage rail — a walk is one
      // route and the map under it is the street being walked, so there is no
      // desktop arrangement where the two sit side by side.
      //
      // `overflow-clip` rather than `overflow-hidden`: both prevent the aside
      // from scrolling by user gesture, but the CSSOM spec treats
      // `overflow-hidden` as a valid scroll target for `Element.scrollIntoView`
      // — so a pin tap that scrolled the tapped row into center inside the
      // WalkView list ALSO scrolled the aside's content up, hiding the drag
      // handle and header above the sheet's own top edge. `overflow-clip`
      // clips content the same way but is excluded from that scroll-target
      // walk, so scrollIntoView reaches only the inner list container.
      className={`absolute inset-x-0 bottom-0 z-20 flex flex-col overflow-clip rounded-t-2xl border-t border-border bg-card shadow-lg transition-[height] duration-[260ms] ease-out ${heightClass}`}
    >
      <div
        role="button"
        tabIndex={0}
        aria-expanded={snap !== 'peek'}
        aria-label={snap === 'full' ? 'Collapse the route' : 'Expand the route'}
        className="mx-auto flex w-full max-w-[608px] shrink-0 cursor-grab touch-none flex-col gap-3 px-4 pt-3 pb-4"
        {...gripHandlers}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            cycle()
          }
        }}
      >
        <span className="mx-auto h-1.5 w-[120px] shrink-0 rounded-full bg-muted-foreground/50" />
        <div className="flex items-center gap-3">
          <h2 className="min-w-0 flex-1 truncate text-xl font-semibold">
            {turfName}
          </h2>
          {/* Labeled "Close route" rather than an X: an X on a peek-visible
              bottom sheet reads as "dismiss this sheet" by every vaul/shadcn
              convention, and dragging the grip to peek already does that. An
              X that instead exits the whole walk violates the strongest
              convention this pattern has.

              The pointer events are stopped rather than the click: the grip
              around this button is driven by pointer handlers, so a press
              that did not stop them would drag the sheet under the finger.
              Keydown is stopped for the keyboard equivalent: the grip treats
              Enter/Space as "cycle the snap" and preventDefaults them, so a
              bubbled keypress on this button would both swallow the button's
              own click and toggle the sheet. */}
          <Button
            variant="ghost"
            size="small"
            className="shrink-0"
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onClick={onExit}
          >
            Close route
          </Button>
        </div>
      </div>
      {snap !== 'peek' && (
        <WalkView
          turfId={turfId}
          onKnockRecorded={onKnockRecorded}
          openStopRequest={openStopRequest}
          selectedStopId={selectedStopId}
          onSelectStop={onSelectStop}
          liveLocation={liveLocation}
          onMoveToArchive={onMoveToArchive}
          archivePending={archivePending}
        />
      )}
    </aside>
  )
}

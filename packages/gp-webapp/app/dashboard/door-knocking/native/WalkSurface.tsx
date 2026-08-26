'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { routeQueryOptions } from './turfQueries'
import { rollupStopStatus, stopIsKnockable } from './statusPresentation'
import type { LiveLocation } from './useLiveLocation'
import type { RoutePin } from './VoterMapCanvas'
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
  openStopRequest: OpenStopRequest | null
  // Which stop is marked. Both directions of it cross this seam, because the
  // list and the map each draw it and only one of them is behind here: the
  // walk reports the stop it opened through `onSelectStop`, and reads the
  // answer back off `selectedStopId` rather than keeping a copy — one value,
  // so the ringed pin and the marked row cannot come apart.
  selectedStopId: number | null
  onSelectStop: (stopId: number) => void
  // "My live location". The canvas keeps this switch in the walk's control row
  // and nowhere else, so the control is behind this seam — but the dot it turns
  // on is drawn by the map, which the orchestrator owns and which outlives the
  // walk. So the watch is read up there and both halves cross: the reading, so
  // the pill can say a permission was blocked, and the switch.
  //
  // A third direction across the seam rather than a second copy of the state,
  // for the same reason `selectedStopId` is: the pill and the dot are one fact
  // drawn twice, and two `useState`s would let them disagree.
  liveLocation: LiveLocation
  liveLocationEnabled: boolean
  onToggleLiveLocation: (next: boolean) => void
  // Lets the page refetch the voter pack after the walk: the landing map's
  // statuses are baked into the cached pack, so new knocks are invisible there
  // until it reloads.
  onKnockRecorded: () => void
}

export default function WalkSurface({
  turfId,
  openStopRequest,
  selectedStopId,
  onSelectStop,
  liveLocation,
  liveLocationEnabled,
  onToggleLiveLocation,
  onKnockRecorded,
}: WalkSurfaceProps) {
  return (
    <WalkView
      turfId={turfId}
      onKnockRecorded={onKnockRecorded}
      openStopRequest={openStopRequest}
      selectedStopId={selectedStopId}
      onSelectStop={onSelectStop}
      liveLocation={liveLocation}
      liveLocationEnabled={liveLocationEnabled}
      onToggleLiveLocation={onToggleLiveLocation}
    />
  )
}

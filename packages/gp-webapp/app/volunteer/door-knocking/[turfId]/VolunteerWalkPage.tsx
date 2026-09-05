'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
} from '@styleguide'
import { CircleAlertIcon, MapPinOffIcon } from '@styleguide/components/ui/icons'
import { noop } from '@shared/utils/noop'
import { clientRequest } from 'gpApi/typed-request'
import { LoadingAnimation } from 'app/shared/utils/LoadingAnimation'
import WalkSurface, {
  useWalkMapSession,
  WalkMapHint,
} from 'app/dashboard/door-knocking/native/WalkSurface'
import { useWalkSession } from 'app/dashboard/door-knocking/native/useWalkSession'
import { useLiveLocation } from 'app/dashboard/door-knocking/native/useLiveLocation'
import { useWalkCompletion } from 'app/dashboard/door-knocking/native/walkCompletion'
import { routeQueryOptions } from 'app/dashboard/door-knocking/native/turfQueries'

// Same seam VoterMapCanvas has behind `NativeDoorKnockingPage` — this page is
// the second mount site (ENG-11055), so it needs its own dynamic import to
// avoid pulling maplibre/deck.gl into a server bundle.
const VoterMapCanvas = dynamic(
  () => import('app/dashboard/door-knocking/native/VoterMapCanvas'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center">
        <LoadingAnimation title="Loading the map…" />
      </div>
    ),
  },
)

// A colour for the draw layers this page never activates. The volunteer walk
// has no create surface, so nothing reads it back — any of the palette would
// do, and this is simply the first swatch (`TURF_COLORS[0]` in turfQueries.ts).
const INERT_DRAW_COLOR = '#2563eb'

const NotAssignedCard = () => (
  <Card className="mx-auto mt-16 max-w-md items-center gap-3 p-8 text-center">
    <span className="flex size-12 items-center justify-center rounded-full bg-muted">
      <MapPinOffIcon className="size-6 text-muted-foreground" />
    </span>
    <p className="m-0 text-sm font-semibold text-foreground">
      You’re no longer assigned to this route
    </p>
    <p className="m-0 max-w-sm text-sm text-muted-foreground">
      Your campaign may have reassigned or removed this walk.
    </p>
    <Button asChild size="small" variant="outline">
      <Link href="/volunteer">Back to your assignments</Link>
    </Button>
  </Card>
)

const LoadErrorCard = ({ onRetry }: { onRetry: () => void }) => (
  <Alert
    variant="destructive"
    icon={<CircleAlertIcon />}
    className="mx-auto mt-16 max-w-md"
  >
    <AlertTitle>Couldn’t load this route</AlertTitle>
    <AlertDescription>Something went wrong loading this walk.</AlertDescription>
    <AlertAction>
      <Button variant="outline" size="small" onClick={onRetry}>
        Try again
      </Button>
    </AlertAction>
  </Alert>
)

// The volunteer half of door knocking (ENG-11055): a route-driven walk with
// no district pack behind it. `GET /v1/door-knocking/pack` stays 403 for a
// volunteer server-side, and this page never calls it — `VoterMapCanvas`'s
// `pack`/`filterResult` props are null here, which omits the district dot
// layer and leaves the camera to the route-fit effect already in that
// component. See `app/dashboard/door-knocking/AGENTS.md` for the seam this
// composes and `NativeDoorKnockingPage` for the candidate/manager equivalent
// this deliberately does not touch.
export default function VolunteerWalkPage({
  turfId,
}: {
  turfId: number
}): React.JSX.Element {
  const router = useRouter()
  const walk = useWalkSession()
  // The turf itself, for its name (the walk session needs one to start) and
  // for `useWalkCompletion`, which needs the full row to derive whether the
  // walk is finished. GET /v1/door-knocking/turfs/:id admits an assigned
  // volunteer (ENG-11051); a reassigned or removed turf 404s.
  const turfQuery = useQuery({
    queryKey: ['door-knocking-turf', turfId],
    queryFn: () =>
      clientRequest('GET /v1/door-knocking/turfs/:id', {
        id: String(turfId),
      }).then((res) => res.data),
  })
  // Same key `useWalkMapSession` and `WalkView` read, so this shares one fetch
  // with both — and, read here too, lets a revoked route's 404 surface as
  // soon as it lands rather than waiting on the turf metadata call to settle
  // first. `useWalkMapSession` gets the id straight from the URL rather than
  // waiting on `walk.turf`, for the same reason: the route depends only on
  // the id, and gating it behind the turf-metadata round trip would toggle
  // this query from disabled to enabled a beat later, firing a second,
  // avoidable fetch against a key this instance already holds.
  const routeQuery = useQuery(routeQueryOptions(turfId))
  const walkMap = useWalkMapSession({ id: turfId })
  const completeFinishedWalk = useWalkCompletion(turfQuery.data ?? null)
  const [locationEnabled, setLocationEnabled] = useState(false)
  const location = useLiveLocation(locationEnabled)
  const [mapControlsOffset, setMapControlsOffset] = useState<number | null>(16)

  // Starts the walk session once, the moment the turf resolves — there is no
  // second entry point onto this page the way `?walkTurfId=` and `?create=1`
  // both land on the dashboard's orchestrator, so there is nothing to
  // disambiguate. `startedRef` rather than a `walk.turf` dependency: the
  // session object is a fresh literal every render, so depending on it would
  // need the same escape hatch this ref is.
  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current || !turfQuery.data) return
    startedRef.current = true
    walk.start(
      { id: turfQuery.data.id, name: turfQuery.data.name },
      'existingRoute',
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turfQuery.data])

  const endWalk = () => {
    // Before `walk.end()` clears the session — the mutation reads the turf
    // out of this render's closure. A no-op unless the list has nothing left
    // to knock (see `walkCompletion.ts`).
    completeFinishedWalk()
    walk.end({ stopCount: walkMap.stopCount })
    walkMap.reset()
    setLocationEnabled(false)
    router.push('/volunteer')
  }

  const revoked =
    (turfQuery.error instanceof FetchError && turfQuery.error.status === 404) ||
    (routeQuery.error instanceof FetchError && routeQuery.error.status === 404)
  if (revoked) return <NotAssignedCard />

  if (turfQuery.isError || routeQuery.isError) {
    return (
      <LoadErrorCard
        onRetry={() => {
          void turfQuery.refetch()
          void routeQuery.refetch()
        }}
      />
    )
  }

  if (!walk.turf) {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] w-full items-center justify-center">
        <LoadingAnimation title="Loading your route…" />
      </div>
    )
  }

  return (
    // 3.5rem = the volunteer top bar's fixed `h-14`, at every width — unlike
    // the dashboard's mobile menu bar (`lg:hidden`), so a bare calc here does
    // not carry the breakpoint trap `app/dashboard/door-knocking/AGENTS.md`
    // documents for that page.
    <div className="relative h-[calc(100dvh-3.5rem)] w-full">
      <VoterMapCanvas
        pack={null}
        filterResult={null}
        turfs={[]}
        routePins={walkMap.routePins}
        selectedStopId={walkMap.selectedStopId}
        routeLoop={walkMap.routeLoop}
        routeGeometry={walkMap.routeGeometry}
        focusTurf={null}
        // Draw-mode props this page never activates — there is no create
        // surface here, so every token stays at its rest value.
        startDrawToken={0}
        clearDrawToken={0}
        undoDrawToken={0}
        drawColor={INERT_DRAW_COLOR}
        frameDrawToken={0}
        frameDrawBottomPct={0}
        controlsHidden={mapControlsOffset === null}
        controlsBottomPx={mapControlsOffset ?? 16}
        location={location}
        liveLocationEnabled={locationEnabled}
        onToggleLiveLocation={setLocationEnabled}
        // Off, same as the candidate/manager walk: the sheet's own line
        // already reports a blocked permission or a coarse fix.
        locationNotice={false}
        // No create surface here to drive it — the canvas requires the prop
        // regardless.
        onPolygonChange={noop}
        onRoutePinClick={walkMap.onPinTap}
      />
      <WalkMapHint visible={walkMap.hintVisible} />
      <WalkSurface
        turfId={walk.turf.id}
        turfName={walk.turf.name}
        onExit={endWalk}
        onMapControlsOffsetChange={setMapControlsOffset}
        onKnockRecorded={walk.recordDoor}
        openStopRequest={walkMap.openStopRequest}
        selectedStopId={walkMap.selectedStopId}
        onSelectStop={walkMap.selectStop}
        liveLocation={location}
      />
    </div>
  )
}

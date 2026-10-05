import { useRef, useState } from 'react'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { outreachProduct } from 'app/(dashboard)/outreach/util/outreachAnalytics'

export interface WalkTurf {
  id: number
  name: string
}

// How the candidate arrived at the walk: straight off building the route, or
// re-opening one built earlier (possibly by a teammate). Same session either
// way, very different behavior leading into it.
export type WalkEntry = 'newRoute' | 'existingRoute'

export interface WalkSession {
  turf: WalkTurf | null
  start: (turf: WalkTurf, entry: WalkEntry) => void
  // Returns how many doors were logged, so the caller can decide whether the
  // landing map's dots have gone stale.
  end: (context: { stopCount: number }) => number
  recordDoor: () => void
}

// A walk session runs from opening the walk view to going back to the map,
// and is the unit the door-knocking funnel is measured in. It lives in its
// own hook rather than inline in the page because a completed session is
// what feeds the activation metric the whole feature is judged by, and that
// accounting is worth being able to test without a map on screen.
//
// The tally is a ref, not state: logging a door mid-walk shouldn't re-render
// the page around the walk view.
// `isServe` is a parameter rather than a `useDoorKnockingServeMode()` read,
// because both callers mount this ABOVE the provider that answers it — the
// dashboard page and the volunteer walk page each know their own surface and
// only wrap the tree below in `DoorKnockingSurface`. Reading the context here
// would silently report Win for every Serve walk.
export const useWalkSession = (isServe: boolean): WalkSession => {
  const [turf, setTurf] = useState<WalkTurf | null>(null)
  const sessionRef = useRef<{ startedAt: number; doorsLogged: number } | null>(
    null,
  )

  const start = (next: WalkTurf, entry: WalkEntry) => {
    sessionRef.current = { startedAt: Date.now(), doorsLogged: 0 }
    setTurf(next)
    trackEvent(EVENTS.DoorKnocking.SessionStarted, {
      product: outreachProduct(isServe),
      turfId: next.id,
      entry,
    })
  }

  const recordDoor = () => {
    if (sessionRef.current) sessionRef.current.doorsLogged += 1
  }

  const end = ({ stopCount }: { stopCount: number }): number => {
    const session = sessionRef.current
    const turfId = turf?.id
    sessionRef.current = null
    setTurf(null)
    if (!session || turfId === undefined) return 0

    const properties = {
      product: outreachProduct(isServe),
      turfId,
      doorsLogged: session.doorsLogged,
      durationSeconds: Math.round((Date.now() - session.startedAt) / 1000),
      stopCount,
    }
    if (session.doorsLogged === 0) {
      trackEvent(EVENTS.DoorKnocking.SessionAbandoned, properties)
      return 0
    }

    trackEvent(EVENTS.DoorKnocking.SessionCompleted, properties)
    // `Outreach - Campaign Completed` is deliberately NOT fired here.
    // A session ends whenever a canvasser stops for the evening, so firing it
    // counted one campaign per sitting and a fifty-door list walked over three
    // evenings as three. The completion event now hangs off the TURF being
    // finished (`turfLifecycle.ts`), which is what `walkCompletion.ts` already
    // stamps on a walk that genuinely ran out of doors.
    return session.doorsLogged
  }

  return { turf, start, end, recordDoor }
}

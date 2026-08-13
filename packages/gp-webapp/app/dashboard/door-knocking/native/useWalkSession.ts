import { useRef, useState } from 'react'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

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
export const useWalkSession = (): WalkSession => {
  const [turf, setTurf] = useState<WalkTurf | null>(null)
  const sessionRef = useRef<{ startedAt: number; doorsLogged: number } | null>(
    null,
  )

  const start = (next: WalkTurf, entry: WalkEntry) => {
    sessionRef.current = { startedAt: Date.now(), doorsLogged: 0 }
    setTurf(next)
    trackEvent(EVENTS.DoorKnocking.SessionStarted, { turfId: next.id, entry })
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
    // Door-knocking activation is counted off this canonical outreach event,
    // so a native walk that doesn't fire it may as well not have happened as
    // far as the metric goes. `method` separates walks logged here from the
    // totals candidates type into the manual "log progress" modal, which
    // fires the same event for the same medium.
    trackEvent(EVENTS.Dashboard.VoterContact.CampaignCompleted, {
      medium: 'doorKnocking',
      method: 'native',
      recipientCount: session.doorsLogged,
      price: 0,
    })
    return session.doorsLogged
  }

  return { turf, start, end, recordDoor }
}

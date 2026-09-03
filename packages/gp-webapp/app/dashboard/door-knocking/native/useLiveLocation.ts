// Deliberately no 'use client': every importer is already a client component
// — NativeDoorKnockingPage, which calls this, carries the directive itself,
// and VoterMapCanvas sits behind next/dynamic (ssr:false). Adding it here
// would push the 'use client' ratchet (scripts/check-use-client-count.mjs) up
// for nothing.
import { useEffect, useState } from 'react'

// A GPS fix worse than this can sit a canvasser several houses — often a
// whole block — from where the dot is drawn, which is actively misleading
// when the question is "which door is next". Past it the dot renders as an
// approximation instead of a confident position.
export const LOW_ACCURACY_METERS = 50

export type LiveLocationStatus =
  // Geolocation can't work here at all (no API, or an insecure context).
  | 'unavailable'
  // The canvasser hasn't asked to be shown.
  | 'off'
  // Watching, no fix yet — this also covers an unanswered permission prompt,
  // because the browser calls neither callback until the user decides.
  | 'locating'
  | 'tracking'
  | 'denied'
  // Transient failure (no satellites, timeout). The watch stays alive.
  | 'error'

export interface LiveLocationFix {
  lng: number
  lat: number
  accuracyMeters: number
}

export interface LiveLocation {
  status: LiveLocationStatus
  fix: LiveLocationFix | null
  approximate: boolean
}

const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  // At a walking pace anything older than a few seconds is a lie.
  maximumAge: 5_000,
  timeout: 20_000,
}

// Geolocation is only exposed in a secure context. On plain http the call
// either throws or silently never answers, so treat it as absent and let the
// control hide itself rather than leaving a spinner up forever.
const isSupported = (): boolean =>
  typeof window !== 'undefined' &&
  window.isSecureContext &&
  typeof navigator !== 'undefined' &&
  Boolean(navigator.geolocation)

/**
 * Client-side only: the fix never leaves the browser. Nothing here posts to
 * gp-api or to analytics — a canvasser's coordinates are their own.
 */
export const useLiveLocation = (enabled: boolean): LiveLocation => {
  const [status, setStatus] = useState<LiveLocationStatus>(() =>
    isSupported() ? 'off' : 'unavailable',
  )
  const [fix, setFix] = useState<LiveLocationFix | null>(null)

  useEffect(() => {
    if (!isSupported()) {
      setStatus('unavailable')
      setFix(null)
      return
    }
    if (!enabled) {
      setStatus('off')
      setFix(null)
      return
    }
    setStatus('locating')

    let watchId: number | null = null
    // A denial (or an unmount) can land before watchPosition has even
    // returned its id, so cancellation is tracked separately and re-checked
    // once the id exists — otherwise the watch would outlive the thing that
    // wanted it and keep the GPS radio warm for the rest of the session.
    let cancelled = false
    const clear = () => {
      cancelled = true
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId)
        watchId = null
      }
    }

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        setFix({
          lng: position.coords.longitude,
          lat: position.coords.latitude,
          accuracyMeters: position.coords.accuracy,
        })
        setStatus('tracking')
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setFix(null)
          setStatus('denied')
          // Nothing will ever arrive on this watch again — stop it rather
          // than leave it registered for the length of the walk.
          clear()
          return
        }
        // POSITION_UNAVAILABLE / TIMEOUT are the doorway, the tunnel, the
        // urban canyon. Keep the watch and the last known fix and let it
        // recover on its own.
        setStatus('error')
      },
      WATCH_OPTIONS,
    )
    if (cancelled) {
      navigator.geolocation.clearWatch(watchId)
      watchId = null
    }

    return clear
  }, [enabled])

  return {
    status,
    fix,
    approximate: fix !== null && fix.accuracyMeters > LOW_ACCURACY_METERS,
  }
}

// The one thing the design's live-location control has no equivalent of, kept
// after the control itself became the map cluster's third button: a blocked
// permission and a coarse fix are the difference between a switch that is off
// and one that cannot work, and an icon toggle on the map cannot say which.
//
// It lives beside the hook rather than beside the switch because there is no
// longer one place the switch is — the cluster holds it and the walk sheet
// reports it — and because it is a reading of this state and nothing else.
// `null` in the two states with nothing to add, so the walk's sheet renders
// nothing at all in the ordinary case; the design's screen has no line here.
export const liveLocationMessage = (location: LiveLocation): string | null => {
  switch (location.status) {
    case 'locating':
      // Also the state while the permission prompt sits unanswered.
      return 'Finding your location…'
    case 'denied':
      return 'Location is blocked. Allow it in your browser settings to see yourself on the map.'
    case 'error':
      return location.fix
        ? 'Location has not updated in a moment.'
        : 'No location fix right now — still trying.'
    case 'tracking':
      return location.approximate
        ? `Approximate location — accurate to about ${Math.round(
            location.fix?.accuracyMeters ?? LOW_ACCURACY_METERS,
          )} m.`
        : null
    default:
      return null
  }
}

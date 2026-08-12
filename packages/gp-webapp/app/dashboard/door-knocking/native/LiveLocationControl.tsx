// No 'use client' — see the note at the top of useLiveLocation.ts. This
// renders inside VoterMapCanvas, which is already client-only.
import { cn, MapPinIcon } from '@styleguide'
import { LiveLocation, LOW_ACCURACY_METERS } from './useLiveLocation'

interface LiveLocationControlProps {
  location: LiveLocation
  enabled: boolean
  onToggle: (next: boolean) => void
}

const statusMessage = (location: LiveLocation): string | null => {
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
        ? `Approximate location — accurate to about ${Math.round(location.fix?.accuracyMeters ?? LOW_ACCURACY_METERS)} m.`
        : null
    default:
      return null
  }
}

/**
 * Sits under maplibre's NavigationControl in the map's top-right stack.
 *
 * Off by default and opt-in: turning it on is what asks the browser for
 * permission, so a candidate drawing turfs at a desk never gets an
 * unsolicited prompt, and no watch runs until someone is actually walking.
 */
export default function LiveLocationControl({
  location,
  enabled,
  onToggle,
}: LiveLocationControlProps) {
  // Degrade quietly: on an insecure origin (or a browser with no geolocation
  // at all) the map is still perfectly usable, so offer nothing rather than
  // a button that can only fail.
  if (location.status === 'unavailable') return null

  const message = statusMessage(location)

  return (
    <div className="pointer-events-none absolute right-2.5 top-28 z-10 flex flex-col items-end gap-1.5">
      <button
        type="button"
        aria-pressed={enabled}
        aria-label={enabled ? 'Hide my location' : 'Show my location'}
        onClick={() => onToggle(!enabled)}
        className={cn(
          'pointer-events-auto flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background shadow-md',
          enabled &&
            'border-tertiary-dark bg-tertiary-dark text-tertiary-foreground',
        )}
      >
        <MapPinIcon size={18} aria-hidden />
      </button>
      {message && (
        <p
          role="status"
          className="max-w-[220px] rounded-md bg-background/95 px-2 py-1 text-right text-xs text-muted-foreground shadow-sm"
        >
          {message}
        </p>
      )}
    </div>
  )
}

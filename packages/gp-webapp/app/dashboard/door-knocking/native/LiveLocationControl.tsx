// No 'use client' — see the note at the top of useLiveLocation.ts. This
// renders inside WalkView, which is already client-only.
import { cn, MapPinIcon, MapPinOffIcon } from '@styleguide'
import { LiveLocation, LOW_ACCURACY_METERS } from './useLiveLocation'

interface LiveLocationControlProps {
  location: LiveLocation
  enabled: boolean
  onToggle: (next: boolean) => void
}

/**
 * The walk control row's pill, in the canvas's own geometry (`ctlPill`,
 * `Voter Outreach.dc.html` line 5300): 34px tall, rounded-full, an icon and a
 * label, and a filled `tertiary-dark` state when it is on.
 *
 * Exported because the row is a row: the read-only travel-mode and loop chips
 * beside this one are the same pill without a switch behind them, and two
 * copies of the shape is how one of them ends up a different height. It lives
 * in this file rather than in `WalkView` because `WalkView` imports this
 * control, and the reverse import would be a cycle.
 */
export const WALK_CONTROL_PILL =
  'inline-flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-3 text-sm font-medium'

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
 * "My live location" — the first control in the walk's row, where the canvas
 * puts it.
 *
 * It used to be a 36px unlabelled icon square floating over the map's
 * top-right corner, under maplibre's zoom stack: a control with no name, in
 * the one part of the map a phone's own chrome and the sheet over it fight
 * for, offering the walk's only piece of live help as something to guess at.
 * The canvas has no map control at all — it is a labelled pill in the row of
 * walk controls, beside the mode and loop chips, and that is now what this is.
 *
 * Off by default and opt-in: turning it on is what asks the browser for
 * permission, so nobody gets an unsolicited prompt, and no watch runs until
 * someone is actually walking. Living in the walk row rather than on the
 * shared canvas is what makes that structural rather than a habit — the
 * control does not exist on the two surfaces where a candidate is at a desk.
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
    <div className="flex min-w-0 flex-col items-start gap-1">
      <button
        type="button"
        aria-pressed={enabled}
        onClick={() => onToggle(!enabled)}
        className={cn(
          WALK_CONTROL_PILL,
          enabled &&
            'border-tertiary-dark bg-tertiary-dark text-tertiary-foreground',
        )}
      >
        {/* The canvas swaps the glyph rather than only the fill
            (`icon(live?'map-pin':'map-pin-off',16)`), so the off state says
            what it is even where the fill is hard to judge — in daylight, on
            a phone at arm's length. */}
        {enabled ? (
          <MapPinIcon size={16} aria-hidden="true" />
        ) : (
          <MapPinOffIcon size={16} aria-hidden="true" />
        )}
        My live location
      </button>
      {/* The one thing the canvas has no equivalent of, kept: a blocked
          permission or a coarse fix is the difference between a control that
          is off and one that cannot work, and the pill alone cannot say
          which. */}
      {message && (
        <p
          role="status"
          className="max-w-[260px] text-xs text-muted-foreground"
        >
          {message}
        </p>
      )}
    </div>
  )
}

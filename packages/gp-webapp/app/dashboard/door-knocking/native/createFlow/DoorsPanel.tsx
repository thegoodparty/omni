import { Button } from '@styleguide'
import type { DoorKnockingAddressPreviewResponse } from '@goodparty_org/contracts'

interface DoorsPanelProps {
  addressPreview: DoorKnockingAddressPreviewResponse | null
  pending: boolean
  failed: boolean
  stale: boolean
  onShow: () => void
  onRetry: () => void
}

// The addresses inside the boundary (ADR 0010), lifted out of the draw step so
// that step can be read against the canvas without four states of a panel in
// the middle of it. Capped in height rather than allowed to grow: the step is
// a shape being reviewed, and a list that eats the viewport takes away the
// thing the candidate is checking it against.
export const DoorsPanel = ({
  addressPreview,
  pending,
  failed,
  stale,
  onShow,
  onRetry,
}: DoorsPanelProps) => (
  <div
    id="draw-step-doors"
    className="max-h-[40dvh] overflow-y-auto rounded-lg border border-border p-3"
  >
    <p className="text-sm font-semibold">The doors inside your boundary</p>
    {pending && (
      <p className="mt-2 text-sm text-muted-foreground">
        Looking up the addresses…
      </p>
    )}
    {failed && (
      <>
        <p className="mt-2 text-sm text-destructive">
          Couldn&rsquo;t load the addresses.
        </p>
        <Button
          size="small"
          variant="secondary"
          className="mt-2"
          onClick={onRetry}
        >
          Try again
        </Button>
      </>
    )}
    {/* The list is of one boundary, and that boundary moved. It is not
        narrowed or widened to fit the new one — showing it under a shape it
        doesn't describe is the failure this panel exists to avoid — so it is
        withdrawn until it is asked for again. */}
    {stale && (
      <>
        <p className="mt-2 text-sm text-muted-foreground">
          Your boundary changed, so these addresses are for the shape you drew
          before.
        </p>
        <Button
          size="small"
          variant="secondary"
          className="mt-2"
          onClick={onShow}
        >
          Show the addresses here
        </Button>
      </>
    )}
    {addressPreview && (
      <>
        {/* No hedge on these counts, because there is nothing left to hedge:
            this is the evaluation the route is built from, with do-not-knock
            and "not a voter" residents already out. What it does need to say
            is that it is a snapshot, since a list saved tomorrow is evaluated
            again. */}
        <p className="text-xs text-muted-foreground">
          Everyone your filters target, as of now — people marked do-not-knock
          or &ldquo;not a voter&rdquo; are already out.
        </p>
        {/* No numbering: nothing has decided a visiting order yet, and the Aug
            14 walkthrough asked numerals out of the list view. */}
        <ul className="mt-2 divide-y divide-border">
          {addressPreview.locations.map((location, index) => (
            <li
              key={index}
              // `block` because globals.css gives every `<li>` inside a
              // `data-slot` element `display: flex`, which would put the "N
              // doors at one location" heading and the doors it introduces on
              // one line.
              className="block py-2"
            >
              {location.doors.length > 1 && (
                <p className="text-xs font-medium">
                  {location.doors.length} doors at one location
                </p>
              )}
              <ul>
                {location.doors.map((door, doorIndex) => (
                  <li key={doorIndex} className="text-sm">
                    {door.address}
                    <span className="text-muted-foreground">
                      {' '}
                      · {door.people.toLocaleString()}{' '}
                      {door.people === 1 ? 'voter' : 'voters'}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        {/* The cap is on stops, so it is stops the shortfall is counted in —
            the same unit the 150 limit is. */}
        {addressPreview.locations.length < addressPreview.stops && (
          <p className="mt-2 text-xs text-muted-foreground">
            Showing the first {addressPreview.locations.length.toLocaleString()}{' '}
            of {addressPreview.stops.toLocaleString()} stops.
          </p>
        )}
      </>
    )}
  </div>
)

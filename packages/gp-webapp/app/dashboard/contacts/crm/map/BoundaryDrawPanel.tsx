import dynamic from 'next/dynamic'
import { IconButton, PlusIcon, Trash2Icon, Undo2Icon } from '@styleguide'
import type { PolygonRing } from 'app/dashboard/shared/ringGeometry'
import type { ContactPoint } from './contactListPoints'

// maplibre-gl touches `window` at module scope, so the canvas cannot be part
// of the server bundle — the same reason ListMapSection loads it this way.
const ContactListMap = dynamic(() => import('./ContactListMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
})

// The control bar's own height plus its bottom offset and a dot's worth of
// clearance, handed to the map so the fit frames every point above it. Kept
// here rather than in the map because this is the component that covers that
// strip; the map only reserves what a caller says it is covering.
const CONTROL_BAR_INSET_PX = 76

// With the shape row above the control bar there are two strips to clear.
const CONTROL_BAR_INSET_WITH_SHAPES_PX = 120

interface BoundaryDrawPanelProps {
  // Coordinates, not people. The panel has no person overlay behind its
  // dots, so it never needs the records they came from.
  points: ContactPoint[]
  truncated: boolean
  // Every part of the boundary, in the order they were drawn. A part can be
  // under three points while it is being cut, so this is not a list of
  // finished shapes.
  rings: PolygonRing[]
  // Which part the map is editing. Always valid: the caller keeps at least
  // one part in `rings`, empty if nothing has been drawn yet.
  activeIndex: number
  onRingsChange: (rings: PolygonRing[]) => void
  onActiveIndexChange: (index: number) => void
  // What the pill reads once there is a shape. The caller resolves it
  // because only the caller knows where its number came from — the server
  // for a list still being built, the dots on screen for a saved one.
  pillLabel: string
  // Shown in the pill's place before the first corner lands.
  hint: string
  className?: string
}

// The map, drawn on. Chrome floats over it: the hint before the first corner,
// then Undo and the running count in the same slot, with Clear and Add shape
// beside them, and a row of shape chips above once there is more than one.
//
// Copied from door knocking's DrawFullScreen rather than shared with it —
// that surface carries a stop cap, a shake animation and an instructions
// dialog this one has no use for, and the two are free to diverge.
export default function BoundaryDrawPanel({
  points,
  truncated,
  rings,
  activeIndex,
  onRingsChange,
  onActiveIndexChange,
  pillLabel,
  hint,
  className = 'h-full w-full',
}: BoundaryDrawPanelProps) {
  const active = rings[activeIndex] ?? []
  const otherRings = rings.filter((_, index) => index !== activeIndex)
  // Nothing drawn at all — not "this part is empty". A holder who has added
  // a second part and not yet placed a corner in it is past the hint.
  const empty = rings.every((ring) => ring.length === 0)
  const multiple = rings.length > 1

  const replaceActive = (ring: PolygonRing) =>
    onRingsChange(rings.map((r, index) => (index === activeIndex ? ring : r)))

  // Removing the last part leaves one empty part rather than none, so the
  // map always has somewhere to put the next corner and no caller has to
  // handle an out-of-range active index.
  const removeActive = () => {
    if (rings.length <= 1) {
      onRingsChange([[]])
      onActiveIndexChange(0)
      return
    }
    onRingsChange(rings.filter((_, index) => index !== activeIndex))
    onActiveIndexChange(Math.max(0, activeIndex - 1))
  }

  const addShape = () => {
    onRingsChange([...rings, []])
    onActiveIndexChange(rings.length)
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <ContactListMap
        contactPoints={points}
        truncated={truncated}
        bottomInsetPx={
          multiple ? CONTROL_BAR_INSET_WITH_SHAPES_PX : CONTROL_BAR_INSET_PX
        }
        drawRing={active}
        otherRings={otherRings}
        onDrawRingChange={replaceActive}
      />

      {/* z-10 because the deck.gl canvas paints into its own stacking
          context and otherwise draws dots straight over these controls —
          a constituent rendered on top of the Clear button reads as a dot
          you can tap and is not one. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex flex-col items-center gap-2 px-4">
        {/* Only once there is a second part. With one shape the chip would
            be a control that switches to the thing already selected. */}
        {multiple && (
          <div
            className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1.5"
            role="group"
            aria-label="Shapes"
          >
            {rings.map((ring, index) => (
              <button
                key={index}
                type="button"
                aria-pressed={index === activeIndex}
                onClick={() => onActiveIndexChange(index)}
                className={`inline-flex h-8 items-center rounded-full border px-3 text-sm font-medium shadow-sm transition-colors ${
                  index === activeIndex
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:bg-muted'
                }`}
              >
                {`Shape ${index + 1}`}
                {ring.length < 3 && (
                  <span className="ml-1.5 text-xs opacity-70">drawing</span>
                )}
              </button>
            ))}
          </div>
        )}
        {empty ? (
          <span className="inline-flex h-10 items-center rounded-full border border-border bg-card px-4 text-center text-sm font-medium text-foreground shadow-sm">
            {hint}
          </span>
        ) : (
          <div className="pointer-events-auto flex items-center gap-2">
            <IconButton
              type="button"
              variant="outline"
              aria-label="Undo last point"
              className="bg-card hover:bg-card"
              onClick={() => replaceActive(active.slice(0, -1))}
            >
              <Undo2Icon className="size-[18px]" />
            </IconButton>
            <span className="inline-flex h-9 items-center rounded-full border border-border bg-card px-3.5 text-sm font-semibold text-foreground">
              {pillLabel}
            </span>
            <IconButton
              type="button"
              variant="outline"
              aria-label={multiple ? 'Remove this shape' : 'Clear boundary'}
              className="bg-card hover:bg-card"
              onClick={removeActive}
            >
              <Trash2Icon className="size-[18px]" />
            </IconButton>
            {/* Offered only once the active part is a real shape. Before
                that, "add another" would hand back an empty part beside an
                empty part and lose the corners already placed in this one. */}
            {active.length >= 3 && (
              <IconButton
                type="button"
                variant="outline"
                aria-label="Add another shape"
                className="bg-card hover:bg-card"
                onClick={addShape}
              >
                <PlusIcon className="size-[18px]" />
              </IconButton>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

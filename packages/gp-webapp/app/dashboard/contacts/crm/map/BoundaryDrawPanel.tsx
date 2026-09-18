import dynamic from 'next/dynamic'
import { IconButton, Trash2Icon, Undo2Icon } from '@styleguide'
import type { PolygonRing } from 'app/dashboard/shared/ringGeometry'
import type { Person } from '../shared/contacts-types'

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

interface BoundaryDrawPanelProps {
  people: Person[]
  truncated: boolean
  ring: PolygonRing
  onRingChange: (ring: PolygonRing) => void
  // What the pill reads once there is a shape. The caller resolves it
  // because only the caller knows where its number came from — the server
  // for a list still being built, the dots on screen for a saved one.
  pillLabel: string
  // Shown in the pill's place before the first corner lands.
  hint: string
  className?: string
}

// The map, drawn on. Chrome floats over it: the hint before the first corner,
// then Undo and the running count in the same slot, with Clear beside them.
// Copied from door knocking's DrawFullScreen rather than shared with it —
// that surface carries a stop cap, a shake animation and an instructions
// dialog this one has no use for, and the two are free to diverge.
export default function BoundaryDrawPanel({
  people,
  truncated,
  ring,
  onRingChange,
  pillLabel,
  hint,
  className = 'h-full w-full',
}: BoundaryDrawPanelProps) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <ContactListMap
        people={people}
        truncated={truncated}
        drawRing={ring}
        onDrawRingChange={onRingChange}
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
        {ring.length === 0 ? (
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
              onClick={() => onRingChange(ring.slice(0, -1))}
            >
              <Undo2Icon className="size-[18px]" />
            </IconButton>
            <span className="inline-flex h-9 items-center rounded-full border border-border bg-card px-3.5 text-sm font-semibold text-foreground">
              {pillLabel}
            </span>
            <IconButton
              type="button"
              variant="outline"
              aria-label="Clear boundary"
              className="bg-card hover:bg-card"
              onClick={() => onRingChange([])}
            >
              <Trash2Icon className="size-[18px]" />
            </IconButton>
          </div>
        )}
      </div>
    </div>
  )
}

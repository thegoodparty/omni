import type { ListShape } from 'app/dashboard/shared/listShapes'

// The shape names under a read-only map, so the colours on it say which
// neighbourhood is which without opening the drawing surface.
export default function ShapeLegend({ shapes }: { shapes: ListShape[] }) {
  if (shapes.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Shapes">
      {shapes.map((shape, index) => (
        // `flex` on the `li` is load-bearing: `globals.css` forces
        // `display: flex` on every `li` under a `[data-slot]` ancestor, and
        // an explicit display utility is what keeps it in our hands.
        <li key={index} className="flex gap-1.5 text-xs text-foreground">
          <span
            aria-hidden="true"
            className="my-auto size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: shape.color }}
          />
          {shape.name}
        </li>
      ))}
    </ul>
  )
}

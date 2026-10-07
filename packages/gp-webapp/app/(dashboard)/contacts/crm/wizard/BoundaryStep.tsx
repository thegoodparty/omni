'use client'

import Body2 from '@shared/typography/Body2'
import type { ContactsLabels } from 'app/(dashboard)/shared/contactsLabels'
import { isPointInRing } from 'app/(dashboard)/shared/ringGeometry'
import type { ListShape } from 'app/(dashboard)/shared/listShapes'
import { geoapifyStaticUrl } from 'app/(dashboard)/door-knocking/native/createFlow/geoapifyStaticUrl'
import { TurfCard } from 'app/(dashboard)/door-knocking/native/createFlow/TurfCard'
import { useMemo, useState } from 'react'
import BoundaryDrawOverlay from '../map/BoundaryDrawOverlay'
import { boundsOf, groupCoordinates } from '../map/contactListPoints'
import { useFilterPoints } from './useFilterPoints'

interface BoundaryStepProps {
  // Every shape of the boundary. Held by the wizard rather than here so
  // leaving the step and coming back does not lose the shapes already cut.
  shapes: ListShape[]
  onShapesChange: (shapes: ListShape[]) => void
  labels: ContactsLabels
  // The same draft payload the count is taken over, so the dots on screen
  // and the number under the cards are answering about one population.
  filters: Record<string, unknown>
  // The in-boundary count from POST /v1/contacts/polygon-preview. The list
  // is not saved yet, so nothing on this screen can be ray-cast against it —
  // only the server knows which of these dots the shapes caught.
  count: number | undefined
  audienceEmpty: boolean | undefined
  isCounting: boolean
  isError: boolean
  errorMessage: string | undefined
  enabled: boolean
}

// What the drawing surface opens on: the shape to put under the cursor, or
// none for a fresh one.
type Drawing = { kind: 'closed' } | { kind: 'open'; activeIndex?: number }

// Step 3 of the Serve wizard, between the filters and the name. Skippable by
// design: a list built from criteria alone is a list, and making the shape
// mandatory would take that away.
//
// Door knocking's draw step, for a list: one big card that opens the
// full-screen drawing surface, and under it a card per shape cut so far,
// each with Edit (back to the map, on that shape) and Delete. A shape's
// name and colour are set on the surface that draws it, so these cards only
// read them.
export default function BoundaryStep({
  shapes,
  onShapesChange,
  labels,
  filters,
  count,
  audienceEmpty,
  isCounting,
  isError,
  errorMessage,
  enabled,
}: BoundaryStepProps) {
  const {
    points: rawPoints,
    truncated,
    isLoading,
  } = useFilterPoints(filters, enabled)
  const [drawing, setDrawing] = useState<Drawing>({ kind: 'closed' })

  // One dot per coordinate, not per person — every unit in an apartment
  // building shares one lat/lon in the voter file, and a dozen coincident
  // dots hide that it is one building holding a dozen people.
  const points = useMemo(() => groupCoordinates(rawPoints), [rawPoints])
  const bounds = useMemo(() => boundsOf(points), [points])

  const hasShape = shapes.length > 0
  const countLine =
    !hasShape || isError
      ? null
      : isCounting || count === undefined
        ? 'Counting…'
        : labels.boundaryCountLabel(count, shapes.length)

  const message = errorMessage
    ? errorMessage
    : isCounting || count === undefined || isError
      ? null
      : audienceEmpty
        ? labels.boundaryEmptyAudience
        : hasShape && count === 0
          ? labels.boundaryEmptyShape
          : null

  // Singular after the first: the press opens the map on ONE new shape.
  const cta = hasShape ? 'Draw another shape' : 'Draw shapes'

  return (
    <div className="flex flex-col gap-6">
      <Body2 className="text-muted-foreground">
        {labels.boundaryGatewayHint}
      </Body2>
      <button
        type="button"
        onClick={() => setDrawing({ kind: 'open' })}
        disabled={isLoading}
        aria-label={cta}
        className="group relative block h-[140px] w-full shrink-0 overflow-hidden rounded-xl border border-border bg-muted transition-colors hover:border-primary lg:h-[170px]"
      >
        {bounds && (
          <img
            src={geoapifyStaticUrl({
              bounds: [
                [bounds.minLng, bounds.minLat],
                [bounds.maxLng, bounds.maxLat],
              ],
              width: 608,
              height: 170,
            })}
            alt=""
            className="h-full w-full object-cover"
          />
        )}
        {/* Washed light so the one control on the card is the subject — the
            same treatment, for the same reasons, as door knocking's. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-background/65"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          {/* A mimic of the primary Button at `size="large"`, because a
              button cannot nest inside the card that is the click target. */}
          <span className="inline-flex h-12 items-center rounded-full border border-primary bg-primary px-6 py-3 text-base font-medium tracking-wide text-primary-foreground transition-colors group-hover:bg-primary/90">
            {isLoading ? 'Loading map…' : cta}
          </span>
        </span>
      </button>
      {hasShape && (
        <div className="flex flex-col gap-2">
          {shapes.map((shape, index) => (
            <TurfCard
              key={index}
              noun="shape"
              name={shape.name}
              color={shape.color}
              assigneeId={null}
              team={[]}
              selected={false}
              counts={labels.boundaryShapeCount(
                points.reduce(
                  (total, point) =>
                    isPointInRing(point.lng, point.lat, shape.ring)
                      ? total + point.residents.length
                      : total,
                  0,
                ),
              )}
              onEdit={() => setDrawing({ kind: 'open', activeIndex: index })}
              onRemove={() =>
                onShapesChange(shapes.filter((_, i) => i !== index))
              }
            />
          ))}
        </div>
      )}
      {(countLine || message) && (
        <div className="flex flex-col gap-1">
          {countLine && (
            <Body2 className="text-foreground" aria-live="polite">
              {countLine}
            </Body2>
          )}
          {message && (
            <Body2
              className={errorMessage ? 'text-destructive' : 'text-foreground'}
              aria-live="polite"
            >
              {message}
            </Body2>
          )}
        </div>
      )}
      {drawing.kind === 'open' && (
        <BoundaryDrawOverlay
          points={points}
          truncated={truncated}
          // The points endpoint selects on lat/lng, so it cannot describe
          // the rows it dropped. See the known gap in contacts/AGENTS.md.
          unmappable={0}
          // Adding opens on a fresh shape, so the press that says "Draw
          // another shape" lands on one. Edit opens on the shape it names.
          initialShapes={shapes}
          initialActiveIndex={drawing.activeIndex ?? shapes.length}
          labels={labels}
          // The dots ARE the filtered audience here, so the ray-cast is
          // honest unless the response was capped.
          isEstimate={truncated}
          // gp-api settles these shapes on the step behind, and Continue is
          // blocked there when they hold nobody.
          allowEmptyShape
          // Nothing is written on Save: the shapes land in the wizard's own
          // state and are saved with the list at the end.
          isSaving={false}
          onCancel={() => setDrawing({ kind: 'closed' })}
          onSave={(next) => {
            onShapesChange(next)
            setDrawing({ kind: 'closed' })
          }}
        />
      )}
    </div>
  )
}

'use client'

import Body2 from '@shared/typography/Body2'
import { Button, CropIcon } from '@styleguide'
import dynamic from 'next/dynamic'
import {
  drawnRings,
  type PolygonRing,
} from 'app/dashboard/shared/ringGeometry'
import type { ContactsLabels } from 'app/dashboard/shared/contactsLabels'
import { useMemo, useState } from 'react'
import BoundaryDrawOverlay from '../map/BoundaryDrawOverlay'
import { groupCoordinates } from '../map/contactListPoints'
import { useFilterPoints } from './useFilterPoints'

// maplibre-gl touches `window` at module scope, so the canvas cannot be part
// of the server bundle — the same reason ListMapSection loads it this way.
const ContactListMap = dynamic(() => import('../map/ContactListMap'), {
  ssr: false,
  loading: () => <MapFrame>Loading map…</MapFrame>,
})

const MapFrame = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-64 items-center justify-center rounded-md border bg-muted/30 text-sm text-muted-foreground">
    {children}
  </div>
)

interface BoundaryStepProps {
  // Every part of the boundary. Held by the wizard rather than here so
  // leaving the step and coming back does not lose the parts already cut.
  rings: PolygonRing[]
  onRingsChange: (rings: PolygonRing[]) => void
  labels: ContactsLabels
  // The same draft payload the count is taken over, so the dots on screen
  // and the number in the pill are answering about one population.
  filters: Record<string, unknown>
  // The in-boundary count from POST /v1/contacts/polygon-preview. The list
  // is not saved yet, so nothing on this screen can be ray-cast against it —
  // only the server knows which of these dots the shape caught.
  count: number | undefined
  audienceEmpty: boolean | undefined
  isCounting: boolean
  isError: boolean
  errorMessage: string | undefined
  enabled: boolean
}

// Step 3 of the Serve wizard, between the filters and the name. Skippable by
// design: a list built from criteria alone is a list, and making the shape
// mandatory would take that away.
//
// A gateway, not a drawing surface: the map here is read-only and the shape
// is cut full-screen, the same way the list detail sheet and the Chief of
// Staff transcript open one. A boundary is aimed at streets, and a 350px
// panel inside a drawer is not enough map to aim with.
export default function BoundaryStep({
  rings,
  onRingsChange,
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
  const [drawing, setDrawing] = useState(false)

  // One dot per coordinate, not per person — every unit in an apartment
  // building shares one lat/lon in the voter file, and a dozen coincident
  // dots hide that it is one building holding a dozen people.
  const points = useMemo(() => groupCoordinates(rawPoints), [rawPoints])

  const hasRing = drawnRings(rings).length > 0
  const countLine =
    !hasRing || isError
      ? null
      : isCounting || count === undefined
        ? 'Counting…'
        : labels.boundaryCountLabel(count)

  const message = errorMessage
    ? errorMessage
    : isCounting || count === undefined || isError
      ? null
      : audienceEmpty
        ? labels.boundaryEmptyAudience
        : hasRing && count === 0
          ? labels.boundaryEmptyShape
          : null

  return (
    <div className="flex flex-col gap-3">
      <Body2 className="text-muted-foreground">
        {labels.boundaryGatewayHint}
      </Body2>
      {isLoading ? (
        <MapFrame>Loading map…</MapFrame>
      ) : (
        <>
          {/* No writer, so the canvas stays the read-only one every other
              preview renders: one dots layer, no click handlers, and the
              ring drawn as an outline. The shape is cut in the overlay
              below. */}
          <div className="h-64 overflow-hidden rounded-md border">
            <ContactListMap
              contactPoints={points}
              truncated={truncated}
              otherRings={rings}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="small"
            className="self-start gap-2"
            onClick={() => setDrawing(true)}
          >
            <CropIcon className="size-4" aria-hidden />
            {hasRing ? labels.boundaryEditCta : labels.boundaryDrawCta}
          </Button>
          {countLine && (
            <Body2 className="text-foreground" aria-live="polite">
              {countLine}
            </Body2>
          )}
          {drawing && (
            <BoundaryDrawOverlay
              points={points}
              truncated={truncated}
              // The points endpoint selects on lat/lng, so it cannot
              // describe the rows it dropped. See the known gap in
              // contacts/AGENTS.md.
              unmappable={0}
              initialRings={drawnRings(rings)}
              labels={labels}
              // The dots ARE the filtered audience here, so the ray-cast is
              // honest unless the response was capped.
              isEstimate={truncated}
              // gp-api settles this shape on the step behind, and Continue
              // is blocked there when it holds nobody.
              allowEmptyShape
              // Nothing is written on Save: the shape lands in the wizard's
              // own state and is saved with the list at the end.
              isSaving={false}
              onCancel={() => setDrawing(false)}
              onSave={(next) => {
                onRingsChange(next)
                setDrawing(false)
              }}
            />
          )}
        </>
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
  )
}

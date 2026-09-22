'use client'

import Body2 from '@shared/typography/Body2'
import type { PolygonRing } from 'app/dashboard/shared/ringGeometry'
import type { ContactsLabels } from 'app/dashboard/shared/contactsLabels'
import { useMemo } from 'react'
import BoundaryDrawPanel from '../map/BoundaryDrawPanel'
import { groupCoordinates } from '../map/contactListPoints'
import { useFilterPoints } from './useFilterPoints'

interface BoundaryStepProps {
  ring: PolygonRing
  onRingChange: (ring: PolygonRing) => void
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
export default function BoundaryStep({
  ring,
  onRingChange,
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

  // One dot per coordinate, not per person — every unit in an apartment
  // building shares one lat/lon in the voter file, and a dozen coincident
  // dots hide that it is one building holding a dozen people.
  const points = useMemo(() => groupCoordinates(rawPoints), [rawPoints])

  const pillLabel =
    isCounting || count === undefined
      ? 'Counting…'
      : labels.boundaryCountLabel(count)

  const message = errorMessage
    ? errorMessage
    : isCounting || count === undefined || isError
      ? null
      : audienceEmpty
        ? labels.boundaryEmptyAudience
        : ring.length >= 3 && count === 0
          ? labels.boundaryEmptyShape
          : null

  return (
    <div className="flex flex-col gap-3">
      <Body2 className="text-muted-foreground">{labels.boundaryStepHint}</Body2>
      {isLoading ? (
        <div className="flex h-[22rem] items-center justify-center rounded-md border bg-muted/30 text-sm text-muted-foreground">
          Loading map…
        </div>
      ) : (
        <BoundaryDrawPanel
          points={points}
          truncated={truncated}
          ring={ring}
          onRingChange={onRingChange}
          pillLabel={pillLabel}
          hint={labels.boundaryStepHint}
          className="h-[22rem] w-full rounded-md border"
        />
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

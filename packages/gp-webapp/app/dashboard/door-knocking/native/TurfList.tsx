'use client'

import { useQuery } from '@tanstack/react-query'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { turfsQueryOptions } from './turfQueries'

interface TurfListProps {
  // Highlights the list whose dots are currently scoped on the map.
  selectedTurfId: number | null
  onFocusTurf: (turf: DoorKnockingTurf) => void
  onShowDetails: (turf: DoorKnockingTurf) => void
  // Knock on an unknocked turf builds the route; on a knocked turf it opens
  // the existing route (the backend call is idempotent either way).
  onKnockTurf: (turf: DoorKnockingTurf) => void
}

export default function TurfList({
  selectedTurfId,
  onFocusTurf,
  onShowDetails,
  onKnockTurf,
}: TurfListProps) {
  const turfsQuery = useQuery(turfsQueryOptions)

  const turfs = turfsQuery.data ?? []

  if (turfsQuery.isPending) {
    return (
      <section className="flex flex-col gap-1.5" aria-busy="true">
        <h2 className="text-sm font-semibold">Saved lists</h2>
        <span className="sr-only">Loading your saved lists</span>
        {[0, 1].map((row) => (
          <span
            key={row}
            aria-hidden="true"
            className="h-11 animate-pulse rounded-md bg-muted"
          />
        ))}
      </section>
    )
  }

  // A failed fetch is not an empty account, and the page already explains a
  // map that couldn't load — inventing a second error here would double up on
  // it, and "No lists yet" would be a guess about why.
  if (turfsQuery.isError) return null

  // The first screen a new candidate sees. Rendering nothing left the rail
  // with a heading, status chips and no explanation of what a list is or how
  // to get one — the only way forward being a button in the page header that
  // nothing on this side pointed at.
  if (turfs.length === 0) {
    return (
      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold">Saved lists</h2>
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          No lists yet. Use <span className="font-medium">Create list</span>{' '}
          above to pick who you want to reach and draw the streets you want to
          walk — saved lists show up here, ready to knock.
        </p>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-sm font-semibold">Saved lists · {turfs.length}</h2>
      {turfs.map((turf) => (
        <div
          key={turf.id}
          data-testid={`turf-row-${turf.id}`}
          className={`flex items-center gap-2 rounded-md border p-2.5 ${
            turf.id === selectedTurfId
              ? 'border-tertiary-dark bg-tertiary-dark/5'
              : 'border-border'
          }`}
        >
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: turf.color }}
          />
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
            onClick={() => onFocusTurf(turf)}
          >
            {turf.name}
          </button>
          {/* Paper without opening the walk first. Only a locked list has a
              route to print, and the file is built by a route handler — so
              this is a plain link, and costs this bundle nothing. */}
          {turf.locked && (
            <a
              href={`/dashboard/door-knocking/print/${turf.id}/pdf`}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-medium underline-offset-2 hover:bg-muted/50 hover:underline"
            >
              PDF
            </a>
          )}
          <Button
            size="small"
            variant="outline"
            onClick={() => onShowDetails(turf)}
          >
            Details
          </Button>
          <Button size="small" onClick={() => onKnockTurf(turf)}>
            Knock
          </Button>
        </div>
      ))}
    </section>
  )
}

'use client'

import { useQuery } from '@tanstack/react-query'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { Button, EyeIcon, EyeOffIcon, IconButton } from '@styleguide'
import { turfsQueryOptions } from './turfQueries'
import DeleteTurfControl from './DeleteTurfControl'

interface TurfListProps {
  // Highlights the list whose dots are currently scoped on the map.
  selectedTurfId: number | null
  // Which outlines the map is not drawing. Display state owned by the page,
  // like the selection — the turf itself carries no visibility.
  hiddenTurfIds: Set<number>
  onFocusTurf: (turf: DoorKnockingTurf) => void
  onToggleTurfVisibility: (turf: DoorKnockingTurf) => void
  onShowDetails: (turf: DoorKnockingTurf) => void
  // Knock on an unknocked turf builds the route; on a knocked turf it opens
  // the existing route (the backend call is idempotent either way).
  onKnockTurf: (turf: DoorKnockingTurf) => void
  // The page drops its own references to a deleted turf (map scope, camera
  // focus, hidden set), which would otherwise go on masking the map to a ring
  // the refetched rail no longer contains.
  onDeletedTurf: (turf: DoorKnockingTurf) => void
}

export default function TurfList({
  selectedTurfId,
  hiddenTurfIds,
  onFocusTurf,
  onToggleTurfVisibility,
  onShowDetails,
  onKnockTurf,
  onDeletedTurf,
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
      {/* The row's affordances are not equally discoverable: Details, Knock,
          PDF, delete and the eye all announce themselves, while tapping the
          NAME is what scopes the map, the voter count and the status legend
          below to that list, and nothing said so. Beside that many controls, a
          name reads as a label rather than a target. */}
      <p className="text-xs text-muted-foreground">
        Tap a list to highlight it on the map, or Knock to start at the first
        door.
      </p>
      {turfs.map((turf) => {
        const hidden = hiddenTurfIds.has(turf.id)
        return (
          <div
            key={turf.id}
            data-testid={`turf-row-${turf.id}`}
            className={`flex items-center gap-2 rounded-md border p-2.5 ${
              turf.id === selectedTurfId
                ? 'border-tertiary-dark bg-tertiary-dark/5'
                : 'border-border'
            }`}
          >
            {/* The dot is the ring's own color, so it doubles as the legend for
                the outline on the map — dimmed when there is no outline to
                match, which is the row's cheapest signal that this list is
                hidden rather than missing. */}
            <span
              className={`h-3 w-3 shrink-0 rounded-full ${hidden ? 'opacity-30' : ''}`}
              style={{ backgroundColor: turf.color }}
            />
            <div className="min-w-0 flex-1">
              <button
                type="button"
                className={`block w-full truncate text-left text-sm font-medium hover:underline ${
                  hidden ? 'text-muted-foreground' : ''
                }`}
                onClick={() => onFocusTurf(turf)}
              >
                {turf.name}
              </button>
              {/* Both figures come from gp-api, which derives them from the
                  frozen route the details sheet reads — the rail and the sheet
                  reporting one list differently is worse than the rail
                  reporting nothing, which is why this is not computed here.
                  Null on an unlocked list, which has no route and so nothing
                  to count; a zero would claim a walked, empty list. */}
              {turf.doorCount !== null &&
                turf.peopleCount !== null &&
                turf.loggedCount !== null && (
                  // Doors and people are two different populations, so they
                  // are two figures rather than one ratio — the logged pair is
                  // people over people, the "People logged" quantity the
                  // details sheet states. Screen readers get the noun the
                  // visible line leaves to context.
                  <p className="truncate text-xs tabular-nums text-muted-foreground">
                    {turf.doorCount} {turf.doorCount === 1 ? 'door' : 'doors'} ·{' '}
                    {turf.loggedCount} of {turf.peopleCount}{' '}
                    <span className="sr-only">people </span>logged
                  </p>
                )}
            </div>
            {/* Named for the list, so a rail of a dozen of these doesn't read
                as a dozen identical buttons to a screen reader. */}
            <IconButton
              aria-label={
                hidden
                  ? `Show ${turf.name} on the map`
                  : `Hide ${turf.name} on the map`
              }
              aria-pressed={hidden}
              onClick={() => onToggleTurfVisibility(turf)}
            >
              {hidden ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
            </IconButton>
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
            {/* Per-list controls belong on the rail, which is where a candidate
                compares lists — and delete lived only inside the details sheet,
                two clicks from the row it acts on. Rendered for a locked list
                too, disabled: gp-api's assertNotLocked still refuses the call,
                but a control that removes itself teaches a candidate the
                feature does not exist. The details sheet carries the sentence
                explaining why it's off; a disabled button has no tooltip to
                carry it here. */}
            <DeleteTurfControl
              turf={turf}
              locked={turf.locked}
              onDeleted={onDeletedTurf}
              compact
            />
          </div>
        )
      })}
    </section>
  )
}

'use client'

import { useQuery } from '@tanstack/react-query'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import {
  ArchiveIcon,
  Button,
  CheckCircleIcon,
  EyeIcon,
  EyeOffIcon,
  HouseIcon,
  IconButton,
  RefreshIcon,
  UsersRoundIcon,
} from '@styleguide'
import { ListCard, type ListCardMetaItem } from 'app/dashboard/shared/ListCard'
import { turfsQueryOptions } from './turfQueries'
import DeleteTurfControl from './DeleteTurfControl'
import {
  canArchiveTurf,
  canCompleteTurf,
  turfStage,
  useTurfLifecycle,
} from './turfLifecycle'

interface TurfListProps {
  // Highlights the list whose dots are currently scoped on the map, and — since
  // the card expands on selection — is also what reveals the end-of-session
  // control at the bottom of that card.
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
            className="h-20 animate-pulse rounded-xl bg-muted"
          />
        ))}
      </section>
    )
  }

  // A failed fetch is not an empty account, and the page already explains a
  // map that couldn't load — inventing a second error here would double up on
  // it, and "No lists yet" would be a guess about why.
  if (turfsQuery.isError) return null

  // `GET turfs` returns archived rows deliberately, carrying `archivedAt`, so
  // the sectioning is the client's job. They come off the active rail because
  // that is what archiving is for, but they are still listed and still
  // restorable: hiding them outright would leave a candidate no way back from a
  // one-tap action, which is the same trap as a delete with no confirm.
  const active = turfs.filter((turf) => turfStage(turf) !== 'archived')
  const archived = turfs.filter((turf) => turfStage(turf) === 'archived')

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

  const row = (turf: DoorKnockingTurf) => (
    <TurfRow
      key={turf.id}
      turf={turf}
      selected={turf.id === selectedTurfId}
      hidden={hiddenTurfIds.has(turf.id)}
      onFocusTurf={onFocusTurf}
      onToggleTurfVisibility={onToggleTurfVisibility}
      onShowDetails={onShowDetails}
      onKnockTurf={onKnockTurf}
      onDeletedTurf={onDeletedTurf}
    />
  )

  return (
    <>
      <section className="flex flex-col gap-2">
        {/* The count is parenthesised rather than the prototype's separator,
            per the 2026-08-20 call: door knocking has no filters CTA to hang
            one off, so the count sits beside the group it describes. */}
        <h2 className="text-sm font-semibold">Saved lists ({active.length})</h2>
        {active.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            Every list is archived. Restore one below, or use{' '}
            <span className="font-medium">Create list</span> above to draw a new
            one.
          </p>
        ) : (
          <>
            {/* The row's affordances are not equally discoverable: Details,
                Knock, PDF, delete and the eye all announce themselves, while
                tapping the NAME is what scopes the map, the voter count and
                the status legend to that list — and beside that many controls,
                a name reads as a label rather than a target. */}
            <p className="text-xs text-muted-foreground">
              Tap a list to highlight it on the map, or Knock to start at the
              first door.
            </p>
            {active.map(row)}
          </>
        )}
      </section>
      {archived.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Archived ({archived.length})
          </h2>
          {archived.map(row)}
        </section>
      )}
    </>
  )
}

interface TurfRowProps {
  turf: DoorKnockingTurf
  selected: boolean
  hidden: boolean
  onFocusTurf: (turf: DoorKnockingTurf) => void
  onToggleTurfVisibility: (turf: DoorKnockingTurf) => void
  onShowDetails: (turf: DoorKnockingTurf) => void
  onKnockTurf: (turf: DoorKnockingTurf) => void
  onDeletedTurf: (turf: DoorKnockingTurf) => void
}

// A component rather than a closure so the lifecycle mutation is per row: one
// hook shared across the rail would report a pending archive on every card.
function TurfRow({
  turf,
  selected,
  hidden,
  onFocusTurf,
  onToggleTurfVisibility,
  onShowDetails,
  onKnockTurf,
  onDeletedTurf,
}: TurfRowProps) {
  const stage = turfStage(turf)
  const lifecycle = useTurfLifecycle(turf)

  // Both figures come from gp-api, which derives them from the frozen route the
  // details sheet reads — the rail and the sheet reporting one list differently
  // is worse than the rail reporting nothing, which is why this is not computed
  // here. Null on an unlocked list, which has no route and so nothing to count;
  // a zero would claim a walked, empty list.
  const meta: ListCardMetaItem[] =
    turf.doorCount !== null &&
    turf.peopleCount !== null &&
    turf.loggedCount !== null
      ? [
          // Doors and people are two different populations, so they are two
          // figures rather than one ratio — the logged pair is people over
          // people, the "People logged" quantity the details sheet states, and
          // deliberately not the prototype's `8 / 24 doors knocked`.
          {
            key: 'doors',
            icon: <HouseIcon size={14} />,
            value: turf.doorCount.toLocaleString(),
            label: turf.doorCount === 1 ? 'door' : 'doors',
          },
          {
            key: 'logged',
            icon: <UsersRoundIcon size={14} />,
            value: `${turf.loggedCount.toLocaleString()} of ${turf.peopleCount.toLocaleString()}`,
            label: 'people logged',
          },
        ]
      : []

  return (
    <ListCard
      data-testid={`turf-row-${turf.id}`}
      // The bar is the ring's own color, so it doubles as the legend for the
      // outline on the map.
      accentColor={turf.color}
      dimmed={hidden || stage === 'archived'}
      selected={selected}
      onSelect={() => onFocusTurf(turf)}
      title={turf.name}
      eyebrow={<StageEyebrow turf={turf} />}
      meta={meta}
      controls={
        <>
          {/* Named for the list, so a rail of a dozen of these doesn't read as
              a dozen identical buttons to a screen reader. */}
          <IconButton
            variant="ghost"
            size="small"
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
          {/* Per-list controls belong on the rail, which is where a candidate
              compares lists — delete lived only inside the details sheet, two
              clicks from the row it acts on. */}
          <DeleteTurfControl
            turf={turf}
            locked={turf.locked}
            onDeleted={onDeletedTurf}
            compact
          />
        </>
      }
      actions={
        <>
          {/* Paper without opening the walk first. Only a locked list has a
              route to print, and the file is built by a route handler — so this
              is a plain link, and costs this bundle nothing. */}
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
            variant="ghost"
            onClick={() => onShowDetails(turf)}
          >
            Details
          </Button>
          {/* The CTA states the canvas asks for: Knock while there is walking
              left, Move to Archive once the list is done. An archived list gets
              Restore instead, because it is the only way back and the section
              it sits in is otherwise a dead end. */}
          {stage === 'archived' ? (
            <Button
              size="small"
              variant="outline"
              disabled={lifecycle.pendingAction === 'restore'}
              onClick={lifecycle.restore}
            >
              <RefreshIcon size={14} />
              Restore
            </Button>
          ) : canArchiveTurf(turf) && stage === 'done' ? (
            <Button
              size="small"
              variant="outline"
              disabled={lifecycle.pendingAction === 'archive'}
              onClick={lifecycle.moveToArchive}
            >
              <ArchiveIcon size={14} />
              Move to Archive
            </Button>
          ) : (
            <Button size="small" onClick={() => onKnockTurf(turf)}>
              Knock
            </Button>
          )}
        </>
      }
      // Ending the session is the one action on this card that can't be undone
      // from the rail — archive has Restore, delete has a confirm — so it sits
      // inside the expanded card rather than in the always-visible footer,
      // where it would be one stray tap from a list that stops offering Knock.
      expandedActions={
        canCompleteTurf(turf) ? (
          <div className="flex flex-col gap-1.5">
            <Button
              size="small"
              variant="outline"
              className="w-full"
              disabled={lifecycle.pendingAction === 'complete'}
              onClick={lifecycle.markDone}
            >
              <CheckCircleIcon size={14} />
              Mark this list done
            </Button>
            <p className="text-xs text-muted-foreground">
              Done lists stop offering Knock and can be moved to the archive.
              Knocks already logged are unaffected.
            </p>
          </div>
        ) : null
      }
    />
  )
}

// The eyebrow is the list's lifecycle stage, not its progress: the numbers moved
// into the meta row below the name, where their icons name the two populations
// the counts must never be confused for each other.
function StageEyebrow({ turf }: { turf: DoorKnockingTurf }) {
  const stage = turfStage(turf)
  if (stage === 'active') return null
  return (
    <p className="mb-0.5 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {stage === 'archived' ? (
        <ArchiveIcon size={12} />
      ) : (
        <CheckCircleIcon size={12} />
      )}
      {stage === 'archived' ? 'Archived' : 'Done'}
    </p>
  )
}

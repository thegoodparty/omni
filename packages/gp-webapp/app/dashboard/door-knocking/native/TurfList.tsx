'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import {
  ArchiveIcon,
  Button,
  CheckCircleIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EllipsisVerticalIcon,
  EyeIcon,
  EyeOffIcon,
  FootprintsIcon,
  HouseIcon,
  IconButton,
  RefreshIcon,
  Trash2Icon,
  UsersRoundIcon,
} from '@styleguide'
import { HistoryStatusText } from 'app/dashboard/outreach/v2/channelMeta'
import { ListCard, type ListCardMetaItem } from 'app/dashboard/shared/ListCard'
import { turfsQueryOptions } from './turfQueries'
import { voterPackQueryOptions } from './useVoterPack'
import DeleteTurfControl from './DeleteTurfControl'
import {
  canArchiveTurf,
  canCompleteTurf,
  turfStage,
  turfStatusLabel,
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
  // The empty state's Create list button was pressed. The rail reports the
  // gesture and never the consequence — the create flow is the orchestrator's,
  // so what "open it" means stays there. Optional: without a handler the card
  // has no button to offer and points at the header's Create list instead,
  // which is what it did before there was one.
  onCreateList?: () => void
}

export default function TurfList({
  selectedTurfId,
  hiddenTurfIds,
  onFocusTurf,
  onToggleTurfVisibility,
  onShowDetails,
  onKnockTurf,
  onDeletedTurf,
  onCreateList,
}: TurfListProps) {
  const turfsQuery = useQuery(turfsQueryOptions)
  // Read-only observer on the page's own pack, `enabled: false` so this rail
  // never triggers a second tens-of-MB download of what the page already
  // fetches and gates the whole feature on — the same read the who step's list
  // picker makes, for the same reason. It exists so the empty state's Create
  // list button can be disabled on `!packQuery.data`, the identical expression
  // the header's Create list button is disabled on: two buttons that open the
  // same flow must not disagree about when they work, and the only way to
  // guarantee that without a prop is to read the same query. An observer
  // rather than `getQueryData` because the button has to come alive if the
  // pack lands while an empty rail is on screen.
  const packQuery = useQuery({ ...voterPackQueryOptions, enabled: false })

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
  // to get one. Explaining it and then pointing at a button elsewhere on the
  // page was the next version of the same problem: the card describes the one
  // thing there is to do here, so it is where the control belongs — the
  // canvas's own `emptyCard` puts a Create list button inside it.
  if (turfs.length === 0) {
    return (
      <section className="flex flex-col gap-1.5">
        <h2 className="text-sm font-semibold">Saved lists</h2>
        <div className="flex flex-col gap-3 rounded-md border border-dashed border-border p-3">
          <p className="text-sm text-muted-foreground">
            No lists yet. Pick who you want to reach and draw the streets you
            want to walk — the list shows up here, ready to knock.
          </p>
          {onCreateList ? (
            // Disabled on exactly what the header's Create list is disabled
            // on. The flow's who step reads the same pack, and without it
            // reports "No matching households" — so a button that opened the
            // flow early would tell a brand-new candidate their district is
            // empty rather than that we are still loading it.
            <Button
              size="small"
              className="self-end"
              disabled={!packQuery.data}
              onClick={onCreateList}
            >
              Create list
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Use <span className="font-medium">Create list</span> above to make
              your first one.
            </p>
          )}
        </div>
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
                Knock, the eye and the overflow menu all announce themselves,
                while tapping the NAME is what scopes the map, the voter count
                and the status legend to that list — and beside that many
                controls, a name reads as a label rather than a target. */}
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
  // The row outlives its own delete trigger, which is a menu item inside a
  // Radix menu that unmounts its content on select — so the open state has to
  // live here rather than inside `DeleteTurfControl`.
  const [deleteOpen, setDeleteOpen] = useState(false)

  // The figures come from gp-api, which derives them from the frozen route the
  // details sheet reads — the rail and the sheet reporting one list differently
  // is worse than the rail reporting nothing, which is why this is not computed
  // here. Null on an unlocked list, which has no route and so nothing to count;
  // a zero would claim a walked, empty list.
  //
  // The canvas's two population figures, in its order and with its icons. Its
  // third item is a route-duration estimate, which this rail has no way to
  // report: `GET /turfs` answers with one batched aggregate and carries no
  // route, and a per-list `serve` fan-out to time each walk is exactly the cost
  // that decision exists to avoid.
  const { doorCount, peopleCount, loggedCount } = turf
  const meta: ListCardMetaItem[] =
    doorCount !== null && peopleCount !== null && loggedCount !== null
      ? [
          {
            key: 'doors',
            icon: <HouseIcon size={14} />,
            value: doorCount.toLocaleString(),
            label: doorCount === 1 ? 'door' : 'doors',
          },
          {
            key: 'people',
            icon: <UsersRoundIcon size={14} />,
            value: peopleCount.toLocaleString(),
            label: peopleCount === 1 ? 'person' : 'people',
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
              a dozen identical buttons to a screen reader. The one control on
              this card the canvas does not have: its map draws every ring at
              once, and a dozen overlapping outlines is what this quiets. */}
          <IconButton
            variant="ghost"
            size="small"
            className="text-muted-foreground"
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
          {/* Delete sits behind the overflow menu, as it does in the canvas.
              Exposed on the card it was a red trash icon one brushed thumb from
              the row it names, competing for the corner with the eye — and it
              is the only control here that destroys anything. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                variant="ghost"
                size="small"
                className="text-muted-foreground"
                aria-label={`More options for ${turf.name}`}
              >
                <EllipsisVerticalIcon size={16} />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2Icon />
                Delete list
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Rendered outside the menu on purpose: the menu takes its own
              children down on select, and the confirmation has to outlive the
              gesture that asked for it. */}
          <DeleteTurfControl
            turf={turf}
            locked={turf.locked}
            onDeleted={onDeletedTurf}
            trigger="none"
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
          />
        </>
      }
      actions={
        <>
          <Button
            size="small"
            variant="ghost"
            onClick={() => onShowDetails(turf)}
          >
            Details
          </Button>
          {/* The CTA states the canvas asks for: Knock while there is walking
              left, Move to archive once the list is done. An archived list gets
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
              Move to archive
            </Button>
          ) : (
            <Button size="small" onClick={() => onKnockTurf(turf)}>
              <FootprintsIcon size={14} />
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

// The overline above the name, and the canvas's own branch: a finished list
// states that it is finished, and every other list reports its progress there.
//
// **The progress figure is the canvas's presentation and position, and
// deliberately not its noun.** The canvas prints `8 / 24 doors knocked`; on our
// data that would pair a people-derived numerator with a door denominator — the
// stops/doors/people rule broken in one sentence, and the reason these figures
// were moved off this line in the first place. The canvas is not making that
// mistake, because its own numbers are households over households; we would be.
// `loggedCount` counts people, so the denominator is `peopleCount` and the
// words are the ones `TurfDetailsSheet` already uses for this exact quantity.
// It sets to the same length, so the overline is the same shape.
//
// "Logged", never "reached" or "knocked": not-home, inaccessible and refused
// all count toward it, and none of them is a conversation.
function StageEyebrow({ turf }: { turf: DoorKnockingTurf }) {
  const stage = turfStage(turf)

  // `HistoryStatusText` rather than a local badge — the details drawer states
  // this same list's status through it, and the canvas's `statusIndicator` is
  // the same thing: a check in `primary`, sentence case, beside the word.
  if (stage !== 'active') {
    return (
      <div className="mb-1.5 flex">
        <HistoryStatusText label={turfStatusLabel(turf)} />
      </div>
    )
  }

  // Null on an unlocked list, which has no route and so nothing to count.
  if (turf.loggedCount === null || turf.peopleCount === null) return null

  return (
    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
      {turf.loggedCount.toLocaleString()} / {turf.peopleCount.toLocaleString()}{' '}
      people logged
    </p>
  )
}

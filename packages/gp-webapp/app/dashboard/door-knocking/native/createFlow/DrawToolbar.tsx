import {
  Button,
  ChevronDownIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  PlusIcon,
  Popover,
  PopoverContent,
  PopoverTrigger,
  UserIcon,
} from '@styleguide'
import { TURF_COLORS, turfColorLabel } from '../turfQueries'
import type { TurfDraft } from '../turfDrafts'

export interface TeamOption {
  userId: number
  label: string
}

interface DrawToolbarProps {
  drafts: TurfDraft[]
  // The turf the three controls act on, or null while a brand-new one is
  // being drawn and has not reached its third corner. Null is a real state
  // and not a loading one: there is nothing to colour or assign yet, so the
  // chip names the turf that is COMING rather than one that exists.
  active: TurfDraft | null
  // What the next turf will be called, for the chip's null state above.
  pendingName: string
  // The hue the canvas is drawing in. Equal to `active.color` whenever there
  // is an active turf; the separate prop is what lets the chip show the right
  // swatch before the third corner lands.
  drawColor: string
  onSelectDraft: (clientId: string) => void
  onStartNewTurf: () => void
  onPickColor: (color: string) => void
  onAssign: (assigneeId: number | null) => void
  // The org's roster. Empty while it loads, or when the team feature is off
  // for this org — the assignee control hides itself rather than opening an
  // empty menu, since there is nothing a candidate can do about it here.
  team: TeamOption[]
}

// The drawing surface's top strip: which turf is being cut, what colour it
// is, who is going to walk it, and a way to start the next one.
//
// A strip rather than a floating cluster, and at the TOP rather than the
// bottom, because the bottom of this surface is already spoken for — the
// hint/undo/count slot and the footer live there, and the map's own control
// cluster sits above them at `DRAW_CONTROLS_BOTTOM_PX`. The top edge is the
// only band on this surface where a persistent control does not collide with
// something that appears and disappears as the shape grows.
//
// Everything is `pointer-events-auto` inside a `pointer-events-none` parent,
// the same rule the rest of the drawing surface follows: a tap that is not on
// a control is a vertex, and the strip must not steal the map's whole top
// edge for a bar that is mostly empty space.
export const DrawToolbar = ({
  drafts,
  active,
  pendingName,
  drawColor,
  onSelectDraft,
  onStartNewTurf,
  onPickColor,
  onAssign,
  team,
}: DrawToolbarProps) => {
  const assignee =
    active?.assigneeId === undefined || active?.assigneeId === null
      ? null
      : (team.find((member) => member.userId === active.assigneeId) ?? null)

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-14 items-center gap-2 px-3">
      {/* The colour swatch is its own control beside the name, not inside
          the turf menu: it is the one thing on this strip that is about the
          turf being drawn RIGHT NOW, and burying a colour change two taps
          deep on a surface where the shape is already on screen wastes the
          one moment the choice can actually be judged. */}
      <div className="pointer-events-auto flex items-center rounded-full border border-border bg-card shadow-sm">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Turf color"
              className="flex size-9 shrink-0 justify-center rounded-l-full pl-3 pr-1"
            >
              <span
                className="my-auto size-4 rounded-full"
                style={{ backgroundColor: drawColor }}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-3">
            <div className="flex gap-2.5">
              {TURF_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={turfColorLabel(option)}
                  aria-pressed={drawColor === option}
                  className={`size-8 rounded-full border-2 ${
                    drawColor === option
                      ? 'border-foreground'
                      : 'border-transparent'
                  }`}
                  style={{ backgroundColor: option }}
                  onClick={() => onPickColor(option)}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-9 max-w-[9rem] items-center gap-1 rounded-r-full pl-1 pr-3 text-sm font-medium text-foreground"
            >
              <span className="truncate">{active?.name ?? pendingName}</span>
              <ChevronDownIcon className="size-4 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[12rem]">
            <DropdownMenuLabel>Turfs in this campaign</DropdownMenuLabel>
            {drafts.map((draft) => (
              <DropdownMenuItem
                key={draft.clientId}
                onSelect={() => onSelectDraft(draft.clientId)}
              >
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: draft.color }}
                />
                <span className="truncate">{draft.name}</span>
              </DropdownMenuItem>
            ))}
            {/* The turf being drawn is not in `drafts` until its third
                corner lands, so it gets a row of its own rather than
                disappearing from the list it is the current member of. */}
            {active === null && (
              <DropdownMenuItem disabled>
                <span
                  aria-hidden="true"
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: drawColor }}
                />
                <span className="truncate">{pendingName}</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onStartNewTurf}>
              <PlusIcon className="size-4" />
              New turf
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Hidden rather than disabled when the roster is empty: an org with
          no team has nobody to assign to, and a control that can only ever
          be pressed to find that out is worse than no control. */}
      {team.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={active === null}
              className="pointer-events-auto flex h-9 max-w-[10rem] items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm font-medium text-foreground shadow-sm disabled:opacity-50"
            >
              <UserIcon className="size-4 shrink-0" />
              <span className="truncate">{assignee?.label ?? 'Assign'}</span>
              <ChevronDownIcon className="size-4 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[12rem]">
            <DropdownMenuLabel>Who walks this turf</DropdownMenuLabel>
            {team.map((member) => (
              <DropdownMenuItem
                key={member.userId}
                onSelect={() => onAssign(member.userId)}
              >
                <span className="truncate">{member.label}</span>
              </DropdownMenuItem>
            ))}
            {assignee && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onAssign(null)}>
                  Unassign
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Button
        type="button"
        size="small"
        variant="outline"
        className="pointer-events-auto ml-auto bg-card hover:bg-card"
        onClick={onStartNewTurf}
      >
        <PlusIcon className="size-4" />
        New turf
      </Button>
    </div>
  )
}

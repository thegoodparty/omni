import {
  Button,
  CheckCircleIcon,
  ChevronDownIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  UserIcon,
} from '@styleguide'
import { useRef, useState, type ReactNode, type RefObject } from 'react'
import { TURF_COLORS, turfColorLabel, turfColorTick } from '../turfQueries'
import type { TeamOption } from '../useTeamOptions'
import { RemoveTurfDialog } from './removeTurfDialog'

interface TurfCardProps {
  name: string
  color: string
  assigneeId: number | null
  // What this turf is worth, right of its name. A node rather than a number
  // because the two callers answer differently: a drawn turf prints its
  // stops, one still being cut prints "Drawing".
  counts: ReactNode
  // Open. Every card in the list is closed but the one being worked on, and
  // the turf under the cursor is that one by definition.
  selected: boolean
  team: TeamOption[]
  cardRef?: RefObject<HTMLDivElement | null>
  // Absent on the turf being cut — it is already the selected one, and a
  // button that selects what is selected is a target with no outcome. Its
  // absence is also what drops the name out of a `button` element.
  onSelect?: () => void
  // Absent for the same turf: there is no draft to remove yet, and Undo is
  // the gesture that takes a corner back.
  onRemove?: () => void
  // Reopen the map with this turf's boundary under the cursor. Only the
  // draw step offers it — on the drawing surface the boundary is already
  // under the cursor, so there is nowhere to go.
  onEdit?: (origin: DOMRect) => void
  onPickColor: (color: string) => void
  onAssign: (assigneeId: number | null) => void
}

// One turf in the panel's list, closed to a row or open onto its settings.
//
// Shared by the campaign's drafts and by the turf still being cut, which is
// the whole reason it is a component: those two were separate markup, the
// second a dashed row with no controls on it, and the panel rearranged
// itself under the cursor at the instant a third corner landed. They are the
// same object at two moments of its life, so they are one card — the second
// simply has no stats and nothing to remove.
export const TurfCard = ({
  name,
  color,
  assigneeId,
  counts,
  selected,
  team,
  cardRef,
  onSelect,
  onRemove,
  onEdit,
  onPickColor,
  onAssign,
}: TurfCardProps) => {
  const member = team.find((option) => option.userId === assigneeId)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  // The row is a button on the whole thing rather than on the name alone,
  // unlike `ListCard`'s rule: selecting a turf is the row's only job here,
  // and Remove is the one other control, kept outside the button as a
  // sibling rather than nested inside it.
  const headingBody = (
    <>
      <span
        aria-hidden="true"
        className="my-auto size-3 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      {/* One line, not two. Everything about a turf that is worth comparing
          down the list is on it: what it is called, who walks it, and what
          it is worth. */}
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {name}
        </span>
        {/* The canvasser and the count are one group, right-aligned, so the
            count's right edge lands in the same column on every row — which
            is the whole point of `tabular-nums`, and what lets a candidate
            compare turf sizes down the list. The group shrinks by
            truncating the NAME, never the number. */}
        <span className="flex min-w-0 items-baseline gap-1 text-xs text-muted-foreground">
          {/* Only when there is one. An "Unassigned" placeholder on every
              card would be noise on the ordinary case, and the open card
              already offers the control. */}
          {member && (
            <>
              <span className="min-w-0 truncate">{member.label}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          {/* Last, and the more important of the two: stops is what decides
              whether a turf can be bought at all — the 150 cap is stated in
              it — it is on every drawn turf, and it moves as the shape is
              dragged, where an assignee is optional and set once. */}
          <span className="shrink-0 tabular-nums">{counts}</span>
        </span>
      </span>
    </>
  )

  return (
    // The padding is on the two halves rather than on the card, which is
    // what lets the rule between them run the full width — a divider inset
    // from the edges reads as a line inside one block, not as the seam
    // between a header and what opened under it. The card clips so the
    // open half's fill respects the bottom corners; `overflow-clip` rather
    // than `overflow-hidden` because `cardRef` is a `scrollIntoView`
    // target and the CSSOM spec treats `hidden` as a scrollable box.
    <div
      ref={(node) => {
        rootRef.current = node
        if (cardRef) cardRef.current = node
      }}
      data-turf-card=""
      className={`flex flex-col overflow-clip rounded-lg border bg-background ${
        selected ? '' : 'border-border'
      }`}
      // The open card is drawn in the turf's OWN colour rather than in the
      // brand's, so the card and the ring it is about are the same object
      // on two surfaces — pick green and the border follows on the next
      // frame, beside a green shape on the map. Inline for the reason the
      // dot and the swatches already are: a turf's colour is data the
      // candidate chose, not a decision this file can name a token for.
      // The two-digit suffixes are hex alpha on the palette's 6-digit hex.
      style={selected ? { borderColor: color } : undefined}
    >
      {/* The whole row opens the card, not just the name.

          This is a deliberate departure from the rule `ListCard` records
          ("selection is a button on the title, never a handler on the
          card"), and it avoids both failures that rule is about. There is
          no `stopPropagation` on each control — one `closest('button')`
          guard ignores any click that landed on one, so adding a third
          control cannot forget to opt out. And the row is NOT given a
          button role: the name stays a real button, which is what a screen
          reader is offered, and this handler is a pointer affordance
          layered over it. No button inside a button. */}
      <div
        className={`flex items-center gap-3 px-3 py-2.5 ${
          onSelect ? 'cursor-pointer' : ''
        }`}
        onClick={(event) => {
          if (!onSelect) return
          if ((event.target as HTMLElement).closest('button')) return
          onSelect()
        }}
      >
        {onSelect ? (
          <button
            type="button"
            aria-current={selected}
            onClick={onSelect}
            className="flex min-w-0 flex-1 gap-3 text-left"
          >
            {headingBody}
          </button>
        ) : (
          <span className="flex min-w-0 flex-1 gap-3">{headingBody}</span>
        )}
        {/* One overflow menu when there are two actions, a bare trash when
          there is one. The design puts a three-dot in the corner; a menu
          holding a single item would be a tap tax, which is the rule this
          directory already records for a draft's Remove.

          HORIZONTAL, and shaped like `ListCard`'s — the CRM's list card is
          the same object as this one (a card in a list, Edit and Delete
          behind a corner menu) and is the pattern to follow. Horizontal is
          what every card and row menu in the app uses; the vertical glyph
          belongs to the generic `MoreMenu` util. */}
        {onEdit ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="small"
                  // Leads with "Options" rather than the turf's name, so a query for
                  // the row by name cannot also match this trigger.
                  aria-label={`Options for ${name}`}
                  className="size-8 shrink-0 p-0"
                >
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    const rect = rootRef.current?.getBoundingClientRect()
                    if (rect) onEdit(rect)
                  }}
                >
                  <PencilIcon className="size-4" />
                  Edit turf
                </DropdownMenuItem>
                {onRemove && (
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setConfirmOpen(true)}
                  >
                    <Trash2Icon className="size-4" />
                    Delete turf
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Sibling of the menu, never inside it — see `RemoveTurfDialog`. */}
            {onRemove && (
              <RemoveTurfDialog
                turfName={name}
                onRemove={onRemove}
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
              />
            )}
          </>
        ) : (
          onRemove && (
            <RemoveTurfDialog turfName={name} onRemove={onRemove}>
              <button
                type="button"
                aria-label={`Delete ${name}`}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2Icon className="size-4" />
              </button>
            </RemoveTurfDialog>
          )
        )}
      </div>
      {/* The open card carries its own settings, and that is the point of
          putting them here rather than in a block under the list: below,
          they said "the selected turf" while the row they meant could be
          scrolled out of sight. Inside the card there is nothing to say —
          the controls are in the thing they change. Being open IS being
          selected, so there is no second disclosure to keep in step. */}
      {selected && (
        <div
          className="flex flex-col gap-4 border-t px-3 py-3"
          style={{
            backgroundColor: `${color}14`,
            borderColor: `${color}33`,
          }}
        >
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Color
            </span>
            {/* Wraps, because eight 32px swatches plus their gaps do not
                clear a 389px card at every zoom. */}
            <div className="flex flex-wrap gap-2">
              {TURF_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={turfColorLabel(option)}
                  aria-pressed={color === option}
                  className={`flex size-7 justify-center rounded-full border-2 ${
                    color === option
                      ? 'border-foreground'
                      : 'border-transparent'
                  }`}
                  style={{ backgroundColor: option }}
                  onClick={() => onPickColor(option)}
                >
                  {/* Inverts with the swatch, the same rule the edit dialog
                      and the walk list's stop numeral follow — a white tick
                      vanishes on green and amber. */}
                  {color === option && (
                    <CheckCircleIcon
                      size={14}
                      aria-hidden="true"
                      className="my-auto"
                      style={{ color: turfColorTick(option) }}
                    />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Hidden rather than disabled when the roster is empty: an org
              with no team has nobody to assign to, and a control whose only
              outcome is finding that out is worse than none. A roster that
              failed to load lands here too. */}
          {team.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Who walks this turf
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="small"
                    className="w-full justify-between bg-background"
                  >
                    <span className="flex min-w-0 gap-2">
                      <UserIcon className="my-auto size-4 shrink-0" />
                      <span className="truncate">
                        {member?.label ?? 'Unassigned'}
                      </span>
                    </span>
                    <ChevronDownIcon className="size-4 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[12rem]">
                  <DropdownMenuLabel>Who walks this turf</DropdownMenuLabel>
                  {team.map((option) => (
                    <DropdownMenuItem
                      key={option.userId}
                      onSelect={() => onAssign(option.userId)}
                    >
                      <span className="truncate">{option.label}</span>
                    </DropdownMenuItem>
                  ))}
                  {member && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => onAssign(null)}>
                        Unassign
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

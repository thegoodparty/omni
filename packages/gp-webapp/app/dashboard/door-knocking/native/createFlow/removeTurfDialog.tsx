import type { ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@styleguide'

interface RemoveTurfDialogProps {
  turfName: string
  onRemove: () => void
  // The control that opens it, when the caller has one to give. Omitted
  // when the opener is a menu item: Radix unmounts a `DropdownMenuContent`'s
  // children on select, so a dialog rendered inside the menu is torn down
  // by the very gesture meant to open it. Such a caller mounts this as a
  // SIBLING of the menu and drives it with the pair below — the same shape
  // `DeleteTurfControl` records for the same reason.
  children?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

// The confirm in front of removing an unbought turf, shared by the two
// surfaces that list turfs — the drawing surface's panel and the draw step's
// cards — for the reason `draftCounts.tsx` is shared: only the WORDING is
// common, and one gesture must not be worded two ways.
//
// **This overturns a recorded decision.** Remove used to fire immediately,
// on the argument that a draft costs nothing and has bought nothing, so the
// worst an accidental tap does is ask for the turf to be drawn again.
// That understates what is lost: drawing a turf is corner-by-corner work
// over a neighbourhood, Undo takes back one corner at a time, and there is
// no undo for the turf itself — so the tap is unrecoverable in the only
// currency this surface has. The trash icon also sits a thumb's width from
// the row that names the turf.
//
// A confirm is enough — nothing here is charged and nothing is tombstoned
// the way a saved list's delete is. The copy does not SAY any of that: the
// candidate is never the one paying, so money has no place in a sentence
// about losing a drawing.
export const RemoveTurfDialog = ({
  turfName,
  onRemove,
  children,
  open,
  onOpenChange,
}: RemoveTurfDialogProps) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    {children && <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>}
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete {turfName}?</AlertDialogTitle>
        {/* Says what is lost, in the candidate's own terms, and nothing
            about what it costs. Nothing is charged to THEM at any point in
            this flow — GoodParty pays the routing vendor — so "nothing has
            been bought yet" invented a worry the product does not have and
            told them about our billing to do it. What they actually lose is
            the drawing. */}
        <AlertDialogDescription>
          You will have to draw this turf again if you change your mind.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep turf</AlertDialogCancel>
        {/* `variant`, never a className. `AlertDialogAction` defaults to the
            `default` variant, which sets a background AND a matching border;
            a caller-side `bg-destructive` overrides the first and loses to
            the second, which is a red button wearing a blue outline. The
            prop exists on this component for exactly that reason. */}
        <AlertDialogAction variant="destructive" onClick={onRemove}>
          Delete
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)

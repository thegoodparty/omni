import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@styleguide'

// The confirm in front of every manual Done, at all three of its objects.
//
// Done is the one lifecycle write with no undo beside it: archive is a
// boolean that flips back and delete has a confirm of its own, while a
// completed list can only be un-completed by archiving and restoring it. At
// the campaign the press finishes N lists at once. That is why this exists.
//
// One component so the gesture cannot be worded three ways, which is the rule
// `createFlow/removeTurfDialog.tsx` records for the same reason. What differs
// per target is only the noun and the number, and both live here rather than
// at the call sites.
//
// The noun follows the SURFACE, not this file. The drawer says turf (its own
// section reads "Turfs in this campaign", its own button "Add another turf");
// the walk says route ("Walk this route"). Both already ship that way, and
// the split is real: a turf is the area that was cut, a route is the walk
// through it. Unifying them is a copy decision of its own, not this one's.
export type MarkDoneTarget =
  | { kind: 'campaign'; unfinishedTurfCount: number }
  | { kind: 'turf'; name: string; unloggedCount: number }
  | { kind: 'route'; unloggedCount: number }

const dialogTitle = (target: MarkDoneTarget): string => {
  if (target.kind === 'campaign') return 'Mark this campaign done?'
  return target.kind === 'turf'
    ? 'Mark this turf done?'
    : 'Mark this route done?'
}

// Says what is not finished, then that it cannot be taken back, and stops.
// Nothing about doors being lost or the route closing, because neither is
// true: done does not mean every door was knocked, which is the point of the
// feature rather than a caveat on it.
const dialogDescription = (target: MarkDoneTarget): string => {
  if (target.kind === 'campaign') {
    return target.unfinishedTurfCount === 1
      ? "1 turf isn't done yet. This marks it done too, and it can't be undone."
      : `${target.unfinishedTurfCount} turfs aren't done yet. This marks them done too, and it can't be undone.`
  }
  const where = target.kind === 'turf' ? ` in ${target.name}` : ''
  return target.unloggedCount === 1
    ? `1 person${where} isn't logged yet. This can't be undone.`
    : `${target.unloggedCount} people${where} aren't logged yet. This can't be undone.`
}

interface MarkDoneDialogProps {
  // Null is closed. A target rather than a separate `open` boolean, because
  // every caller holds the thing being marked anyway and two pieces of state
  // for one fact is how a dialog comes to describe the wrong row.
  target: MarkDoneTarget | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  pending?: boolean
}

export const MarkDoneDialog = ({
  target,
  onOpenChange,
  onConfirm,
  pending = false,
}: MarkDoneDialogProps) => (
  <AlertDialog open={target !== null} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      {target && (
        <>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogTitle(target)}</AlertDialogTitle>
            <AlertDialogDescription>
              {dialogDescription(target)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              Keep knocking
            </AlertDialogCancel>
            {/* No `variant`. The brand default is right here and the
                destructive one would be a lie: nothing is deleted and nothing
                is charged, so a red button promises a loss this act does not
                cause. `contacts/crm/lists/DuplicateListDialog.tsx` is the
                precedent for a non-destructive confirm; `removeTurfDialog`
                is the precedent for the other kind and says why it passes a
                prop rather than a className.

                This dialog never closes ITSELF. `AlertDialogAction` is a
                Radix Close underneath, so the preventDefault is what lets a
                caller hold it open until its mutation resolves; the walk's
                caller closes it in `onConfirm` instead, because its write is
                the orchestrator's and reports no resolution back across that
                seam, exactly as `Move to archive` already doesn't. */}
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                onConfirm()
              }}
            >
              Mark done
            </AlertDialogAction>
          </AlertDialogFooter>
        </>
      )}
    </AlertDialogContent>
  </AlertDialog>
)

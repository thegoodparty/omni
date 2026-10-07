import { useState, type ReactNode } from 'react'
import type { DoorKnockingTurf } from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { TurfAssigneeMenu } from 'app/(dashboard)/outreach/v2/TurfAssigneeMenu'
import { WhatWeHeardLink } from 'app/(dashboard)/issue-capture/WhatWeHeardLink'
import { MarkDoneDialog, type MarkDoneTarget } from './MarkDoneDialog'
import { TurfSummaryCard } from './TurfSummaryCard'
import { turfStage, turfStatusLabel, useTurfLifecycle } from './turfLifecycle'

// One turf of a campaign, everywhere a campaign's turfs are listed: the
// create flow's success screen and the outreach drawer's sibling list.
//
// **This owns everything the two surfaces share, and takes only what
// differs.** `TurfSummaryCard` under it is the shape — the dot, the counts,
// the bar, the washed footer — and this is the BEHAVIOUR: who walks the
// turf, and marking it done behind its confirm. The split matters because
// the card stays renderable with no providers (which is what makes its
// Storybook worth having), while this one reads the organization, fires a
// query and owns a mutation.
//
// It exists because the success screen was built by passing slots to the
// card and quietly passed the wrong ones — no assignee control, an invented
// text label where the drawer has Mark as done. Two surfaces composing the
// same parts by hand is not a shared component, and a screenshot comparison
// is a poor way to find out.
type Props = {
  // Which product's event names this row's lifecycle writes report under.
  isServe: boolean
  turf: DoorKnockingTurf
  // The only real difference between the two surfaces. The drawer
  // deep-links into that turf's walk carrying the anchor's `outreachId`;
  // the success screen is still inside the flow and calls back into it.
  action: ReactNode
  // Radix portals the assignee menu and the confirm, so a surface that
  // lives inside a dismissable overlay has to be told one is up or the
  // dismissing click closes the overlay too. The success screen is not in
  // one, and passes nothing.
  onOverlayOpenChange?: (open: boolean) => void
  onTurfCompleted?: (turfId: number) => void
}

export const TurfSummaryRow = ({
  isServe,
  turf,
  action,
  onOverlayOpenChange,
  onTurfCompleted,
}: Props) => {
  const [markDoneTarget, setMarkDoneTarget] = useState<MarkDoneTarget | null>(
    null,
  )
  const lifecycle = useTurfLifecycle(turf, isServe)
  // A shelved OR finished turf is still in these lists, and neither offers
  // anything to do: an archived list is one the candidate put away, and what
  // Done takes away IS Knock (`walkCompletion.ts`).
  const active = turfStage(turf) === 'active'
  const unlogged = Math.max(0, turf.peopleCount - turf.loggedCount)
  const pending = lifecycle.pendingAction === 'complete'
  const openConfirm = (open: boolean) => {
    setMarkDoneTarget(
      open ? { kind: 'turf', name: turf.name, unloggedCount: unlogged } : null,
    )
    onOverlayOpenChange?.(open)
  }

  return (
    <>
      <TurfSummaryCard
        turf={turf}
        muted={!active}
        // Who walks it, as the control that changes it. On a turf nobody is
        // walking any more there is nothing to hand over, so the status
        // takes the slot instead — one thing in the top right either way.
        trailing={
          active ? (
            <TurfAssigneeMenu
              outreachId={turf.outreachId}
              onMenuOpenChange={onOverlayOpenChange}
            />
          ) : (
            <span className="shrink-0 text-sm font-medium text-muted-foreground">
              {turfStatusLabel(turf)}
            </span>
          )
        }
        // On a finished turf too: Done is when the summary runs, so that is
        // when the report has the most to say.
        heard={
          <WhatWeHeardLink
            outreachId={turf.outreachId}
            isServe={isServe}
            className="border-t border-border pt-2"
          />
        }
        footer={
          active ? (
            <>
              {/* The quieter of the two: it ends the turf, so it is a text
                  button beside the filled one rather than competing with
                  it. Both `size="small"` and neither restyled — the row's
                  `justify-between` is what positions them. */}
              <Button
                type="button"
                variant="ghost"
                size="small"
                disabled={pending}
                onClick={() => {
                  // Nothing to warn about on a fully logged turf.
                  if (unlogged <= 0) {
                    return lifecycle.markDone({
                      onSuccess: () => onTurfCompleted?.(turf.id),
                    })
                  }
                  openConfirm(true)
                }}
              >
                Mark as done
              </Button>
              {action}
            </>
          ) : null
        }
      />
      <MarkDoneDialog
        target={markDoneTarget}
        onOpenChange={openConfirm}
        pending={pending}
        // Held open until the write resolves: the dialog preventDefaults for
        // us, and a failure then leaves a dialog the candidate can retry
        // from rather than a snackbar behind a sheet they stopped looking
        // at.
        onConfirm={() =>
          lifecycle.markDone({
            onSuccess: () => {
              openConfirm(false)
              onTurfCompleted?.(turf.id)
            },
          })
        }
      />
    </>
  )
}

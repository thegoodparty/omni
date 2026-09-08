'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@styleguide'

interface DoorKnockingDailyLimitDialogProps {
  // The daily campaign cap the server reported (`quota.campaignLimit`). Null
  // when there's nothing to show; drives both open state and the number in
  // the body copy so caller state stays a single value.
  limit: number | null
  onDismiss: () => void
}

// Shared refusal dialog for the per-day door-knocking campaign quota. Both
// the outreach hub (which intercepts a tile click when the quota is already
// spent) and NativeDoorKnockingPage (a safety net for direct-URL entry and
// for a hub-side race) mount it — same copy, same one-button exit, so a
// candidate who hits the limit sees the same message wherever the check
// fires. One action and no cancel: there's nothing to decide.
export const DoorKnockingDailyLimitDialog = ({
  limit,
  onDismiss,
}: DoorKnockingDailyLimitDialogProps) => (
  <AlertDialog
    open={limit !== null}
    onOpenChange={(next) => {
      if (!next) onDismiss()
    }}
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Daily limit reached</AlertDialogTitle>
        <AlertDialogDescription>
          {`You created ${limit} door knocking campaigns today. Go knock the doors you've already mapped, and build more lists tomorrow.`}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogAction onClick={onDismiss}>Got it</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)

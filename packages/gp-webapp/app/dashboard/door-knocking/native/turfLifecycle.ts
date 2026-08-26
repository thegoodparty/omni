import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import { turfsQueryOptions } from './turfQueries'

// The three states a saved list can be in, as one value rather than two
// timestamps every caller re-derives. Archived wins over done because the shelf
// is what the rail sections on: an archived list is off the rail whether or not
// the walk it holds was finished.
export type TurfLifecycleStage = 'active' | 'done' | 'archived'

export const turfStage = (turf: DoorKnockingTurf): TurfLifecycleStage =>
  turf.archivedAt ? 'archived' : turf.completedAt ? 'done' : 'active'

// The canvas's own status indicator for a saved list, in the vocabulary the
// outreach history drawer already renders through `HistoryStatusText`: the two
// details drawers are one component family from two entry points, so one list
// must not be "In progress" in one and unlabelled in the other.
//
// `renderDkDetails` derives it as
// `list.completed?'done':(knocked>0?'in-progress':'scheduled')`, which is
// lockedness here — a turf is locked iff its frozen route exists, and a route
// exists iff someone started knocking it. Archived is ours: the canvas has no
// shelf, and 'Done' would be a lie about a list the rail has taken off the
// active section.
//
// The unknocked state reads **"Not started" and not the canvas's "Scheduled"**,
// which is the one place this map departs from `renderDkDetails` on purpose. The
// canvas's six-state vocabulary has no "hasn't begun yet" bucket, so its door
// knocking screen borrows `scheduled` — a word that is literally true of the
// sending channels it was written for, where the flow ends on a date picker and
// the row genuinely carries a `scheduledAt`. Door knocking has no send time and
// no date picker: a list is drawn on a map and walked whenever somebody walks
// it. A domain reviewer read the label and asked when it had been scheduled,
// which is the correct question and has no answer. "Not started" says the same
// thing the canvas meant (`knocked === 0`) in the words this vocabulary already
// uses for the other two positions of the same axis — Not started, In progress,
// Done.
//
// It cannot collide with the sending channels' "Scheduled", which stays exactly
// as it was for a paid text or robocall: this label never reaches those rows,
// and no door-knocking row ever reaches theirs. Nor can the two details drawers
// disagree about one list — the `Outreach` envelope that would let the history
// table describe a walk is written by the knock transaction, so a list in this
// state has no envelope and appears in no history at all. Once it does, the
// envelope reads `in_progress` and both surfaces say "In progress".
export const turfStatusLabel = (turf: DoorKnockingTurf): string => {
  const stage = turfStage(turf)
  if (stage === 'archived') return 'Archived'
  if (stage === 'done') return 'Done'
  return turf.locked ? 'In progress' : 'Not started'
}

export type TurfLifecycleAction = 'complete' | 'archive' | 'restore'

// gp-api applies all three transitions only to a KNOCKED list — a turf with no
// route 409s, because there is no walk to end or shelve. The rail therefore
// offers them off `locked` rather than off the timestamps, so a control is
// never rendered for a call that can only fail.
export const canCompleteTurf = (turf: DoorKnockingTurf) =>
  turf.locked && turfStage(turf) === 'active'

export const canArchiveTurf = (turf: DoorKnockingTurf) =>
  turf.locked && turfStage(turf) !== 'archived'

/**
 * The list lifecycle as three one-shot mutations against one turf.
 *
 * They live together because they share every decision worth making once: the
 * rail is the only reader of all three, `archive` and `restore` are the same
 * endpoint with the boolean flipped, and each has to invalidate the rail before
 * it reports success — the card the candidate is looking at is what moves
 * between sections, so a snackbar arriving ahead of the refetch would announce
 * a change the screen has not made yet.
 *
 * Each action is ONE request. Shelving a list moves two rows — the turf the
 * candidate acts on and the `Outreach` envelope the campaign-reporting history
 * filters on — but both moves happen inside gp-api's `setArchived` transaction,
 * the way `complete` has always mirrored `status` onto the same envelope. This
 * hook briefly did that second write itself, best effort, while gp-api was
 * frozen; that is gone, so there is no half-applied archive left to report and
 * no non-webapp caller that can skip the mirror by not being this code.
 *
 * Nothing here is optimistic. `complete` and `archive` are idempotent server
 * side (a second call returns the row untouched rather than moving its
 * timestamp), so a retry is cheap and a rollback path would be more machinery
 * than the failure is worth.
 */
export const useTurfLifecycle = (turf: DoorKnockingTurf) => {
  const queryClient = useQueryClient()
  const { successSnackbar, errorSnackbar } = useSnackbar()

  const mutation = useMutation({
    mutationFn: (action: TurfLifecycleAction) =>
      action === 'complete'
        ? clientRequest('POST /v1/door-knocking/turfs/:id/complete', {
            id: String(turf.id),
          })
        : clientRequest('POST /v1/door-knocking/turfs/:id/archive', {
            id: String(turf.id),
            archived: action === 'archive',
          }),
    onSuccess: async (_data, action) => {
      await queryClient.invalidateQueries({
        queryKey: turfsQueryOptions.queryKey,
      })
      successSnackbar(SUCCESS_MESSAGE[action])
    },
    onError: (_error, action) => {
      errorSnackbar(FAILURE_MESSAGE[action])
    },
  })

  return {
    markDone: () => mutation.mutate('complete'),
    moveToArchive: () => mutation.mutate('archive'),
    restore: () => mutation.mutate('restore'),
    // Which one is in flight, so a card can disable the control that is running
    // without freezing the two beside it.
    pendingAction: mutation.isPending
      ? (mutation.variables as TurfLifecycleAction)
      : null,
  }
}

const SUCCESS_MESSAGE: Record<TurfLifecycleAction, string> = {
  complete: 'List marked done',
  archive: 'Moved to archive',
  restore: 'Restored from archive',
}

// Named for the action rather than a single "Something went wrong", because
// these three sit on one card and a candidate who pressed two of them needs to
// know which one did not land.
const FAILURE_MESSAGE: Record<TurfLifecycleAction, string> = {
  complete: 'This list could not be marked done. Try again.',
  archive: 'This list could not be archived. Try again.',
  restore: 'This list could not be restored. Try again.',
}

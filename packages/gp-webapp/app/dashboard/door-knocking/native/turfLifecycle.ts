import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import { TURFS_QUERY_KEY } from './turfQueries'

// The three states a saved list can be in, as one value rather than two
// timestamps every caller re-derives. Archived wins over done because the shelf
// is what the rail sections on: an archived list is off the rail whether or not
// the walk it holds was finished.
export type TurfLifecycleStage = 'active' | 'done' | 'archived'

export const turfStage = (turf: DoorKnockingTurf): TurfLifecycleStage =>
  turf.archivedAt ? 'archived' : turf.completed ? 'done' : 'active'

// The canvas's own status indicator for a saved list, in the vocabulary the
// outreach history drawer already renders through `HistoryStatusText`: the two
// details drawers are one component family from two entry points, so one list
// must not be "In progress" in one and unlabelled in the other.
//
// `renderDkDetails` derives it as
// `list.completed?'done':(knocked>0?'in-progress':'scheduled')`, and now that
// a list is born with its route, that middle test is readable literally: doors
// knocked, not lockedness. Archived is ours: the canvas has no shelf, and
// 'Done' would be a lie about a list the rail has taken off the active
// section.
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
// disagree about one list: every list has an `Outreach` envelope from creation
// now, and the envelope's `in_progress` covers both positions this label splits
// — the history table says "In progress" from the first door, this rail says it
// from the first knock, and they are the same list either way.
export const turfStatusLabel = (turf: DoorKnockingTurf): string => {
  const stage = turfStage(turf)
  if (stage === 'archived') return 'Archived'
  if (stage === 'done') return 'Done'
  return turf.knockedDoorCount > 0 ? 'In progress' : 'Not started'
}

export type TurfLifecycleAction =
  | 'complete'
  | 'archive'
  | 'restore'
  // The walk view's one bottom button. The design labels it `Move to archive`
  // and its own handler marks the list *completed*, toasting "List completed" —
  // one gesture standing for both halves of a thing this product has always
  // kept apart, because the canvas has no shelf and so no reason to. Splitting
  // it back into two buttons would be inventing a control the design does not
  // have; dropping the completion would leave a walked-out list on the shelf
  // still reading "In progress" in the history table, which is the fact the
  // `complete` endpoint exists to write. So the label ships as designed and
  // both writes happen behind it, in that order.
  | 'completeAndArchive'

// Both transitions used to also test `locked`, because a routeless turf 409s —
// there is no walk to end or shelve. Every list is routed from creation now, so
// that half is always true and only the stage is left.
export const canCompleteTurf = (turf: DoorKnockingTurf) =>
  turfStage(turf) === 'active'

export const canArchiveTurf = (turf: DoorKnockingTurf) =>
  turfStage(turf) !== 'archived'

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
 * Each action is ONE request against ONE row. The lifecycle lives on the
 * `Outreach` envelope alone now — these endpoints take a turf id and write the
 * envelope it hangs off — so there is no second copy to mirror onto and
 * nothing that can be half-applied. Both the rail here and the outreach
 * history table are reading the same field.
 *
 * Nothing here is optimistic. `complete` and `archive` are idempotent server
 * side (a second call returns the row untouched rather than moving its
 * timestamp), so a retry is cheap and a rollback path would be more machinery
 * than the failure is worth.
 */
export const useTurfLifecycle = (turf: DoorKnockingTurf) => {
  const queryClient = useQueryClient()
  const { successSnackbar, errorSnackbar } = useSnackbar()

  const complete = () =>
    clientRequest('POST /v1/door-knocking/turfs/:id/complete', {
      id: String(turf.id),
    })
  const setArchived = (archived: boolean) =>
    clientRequest('POST /v1/door-knocking/turfs/:id/archive', {
      id: String(turf.id),
      archived,
    })

  const mutation = useMutation({
    mutationFn: async (action: TurfLifecycleAction) => {
      if (action === 'complete') return complete()
      if (action === 'restore') return setArchived(false)
      if (action === 'archive') return setArchived(true)
      // Sequential and not concurrent: both write the same envelope row, so
      // the two racing is a lost update. Completion first also means a failure
      // part-way leaves the list finished but not shelved — visible on the
      // rail with `Move to archive` still offered — rather than shelved while
      // its history still says the walk is running.
      await complete()
      return setArchived(true)
    },
    onSuccess: async (_data, action) => {
      await queryClient.invalidateQueries({
        queryKey: TURFS_QUERY_KEY,
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
    finishAndArchive: (options?: { onSettled?: () => void }) =>
      mutation.mutate('completeAndArchive', {
        // The walk closes on either outcome. A failed archive has already told
        // the canvasser so, and holding them inside a route they have walked
        // out of until a retry succeeds is worse than putting them back on the
        // rail where the card still offers the shelf.
        onSettled: options?.onSettled,
      }),
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
  completeAndArchive: 'Moved to archive',
}

// Named for the action rather than a single "Something went wrong", because
// these three sit on one card and a candidate who pressed two of them needs to
// know which one did not land.
const FAILURE_MESSAGE: Record<TurfLifecycleAction, string> = {
  complete: 'This list could not be marked done. Try again.',
  archive: 'This list could not be archived. Try again.',
  restore: 'This list could not be restored. Try again.',
  completeAndArchive: 'This list could not be archived. Try again.',
}

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
 * Nothing here is optimistic. `complete` and `archive` are idempotent server
 * side (a second call returns the row untouched rather than moving its
 * timestamp), so a retry is cheap and a rollback path would be more machinery
 * than the failure is worth.
 */
export const useTurfLifecycle = (turf: DoorKnockingTurf) => {
  const queryClient = useQueryClient()
  const { successSnackbar, errorSnackbar } = useSnackbar()

  const run = (action: TurfLifecycleAction) =>
    action === 'complete'
      ? clientRequest('POST /v1/door-knocking/turfs/:id/complete', {
          id: String(turf.id),
        })
      : clientRequest('POST /v1/door-knocking/turfs/:id/archive', {
          id: String(turf.id),
          archived: action === 'archive',
        })

  const mutation = useMutation({
    mutationFn: (action: TurfLifecycleAction) => run(action),
    onSuccess: async (_response, action) => {
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

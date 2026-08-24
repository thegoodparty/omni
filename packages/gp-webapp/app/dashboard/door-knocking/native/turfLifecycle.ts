import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
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

// Shelving a list writes TWO rows, and this is the only place either of them
// moves. `DoorKnockingTurf.archivedAt` is the object a candidate acts on — it
// exists for a Serve org, which has no campaign and therefore no envelope at
// all — while `Outreach.archivedAt` is the campaign-reporting projection of
// the same walk, and it is what the v2 outreach history's Archive toggle
// filters on. Nothing joined them, so a list could be shelved on the rail and
// still be sitting in active outreach history. `turfService.complete` already
// mirrors its half of the lifecycle onto the envelope (`status: completed`,
// matched on `doorKnockingRouteId`); `setArchived` does not, so the mirror
// runs here until it does — the durable fix is those same few lines added to
// gp-api's `setArchived`, and both AGENTS.md files say so.
//
// It only resolves in this direction. The envelope carries the route id, so
// turf -> route -> envelope works; nothing maps a route id back to its turf,
// which is why the outreach history drawer offers no archive on a
// door-knocking row and points here instead. A second writer that could only
// reach the projection is exactly the drift this closes.
//
// The route lookup is a fetch rather than a prop because archive is offered
// from two surfaces — the rail card and the list details drawer — and only one
// of them has route data on hand. `canArchiveTurf` requires `locked`, and
// lockedness IS the frozen route's existence, so the row is always there.
const mirrorArchiveToOutreach = async (
  turfId: number,
  archived: boolean,
): Promise<void> => {
  const { data: payload } = await clientRequest(
    'GET /v1/door-knocking/turfs/:id/route',
    { id: String(turfId) },
  )
  // Campaign-scoped, and 404s for a campaign with no outreach at all — the
  // same shape as "this org has no envelope", which is the normal case for a
  // Serve org. Not a failed archive, so it resolves to "nothing to mirror".
  // Only that status: a 401 or a 500 means we never learned whether there was
  // an envelope, and swallowing those would report a clean archive over a
  // mirror that silently did not happen.
  const rows = await clientRequest('GET /v1/outreach', {}).catch((error) => {
    if (error instanceof FetchError && error.status === 404) return null
    throw error
  })
  const envelope = rows?.data.find(
    (row) => row.doorKnockingRouteId === payload.route.id,
  )
  if (!envelope) return
  await clientRequest('PATCH /v1/outreach/:id/archive', {
    id: String(envelope.id),
    archived,
  })
}

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

  const run = async (action: TurfLifecycleAction) => {
    if (action === 'complete') {
      await clientRequest('POST /v1/door-knocking/turfs/:id/complete', {
        id: String(turf.id),
      })
      return { mirrorFailed: false }
    }
    await clientRequest('POST /v1/door-knocking/turfs/:id/archive', {
      id: String(turf.id),
      archived: action === 'archive',
    })
    // Two writes and no transaction, so the turf goes first and a failed
    // mirror leaves the history row stale rather than a list shelved nowhere.
    // Reported as a lagging projection rather than as a failed archive: the
    // list HAS moved, and "couldn't archive" would send someone to press it
    // again against a list that already did.
    try {
      await mirrorArchiveToOutreach(turf.id, action === 'archive')
      return { mirrorFailed: false }
    } catch {
      return { mirrorFailed: true }
    }
  }

  const mutation = useMutation({
    mutationFn: (action: TurfLifecycleAction) => run(action),
    onSuccess: async ({ mirrorFailed }, action) => {
      await queryClient.invalidateQueries({
        queryKey: turfsQueryOptions.queryKey,
      })
      if (mirrorFailed && action !== 'complete') {
        errorSnackbar(MIRROR_LAG_MESSAGE[action])
        return
      }
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

// The list moved and its outreach history row did not. Deliberately not one of
// the failure messages below: those say the action did not land, and pressing
// again is the right response to them. Here it is not — the list is already
// shelved, and the only thing behind is a projection that a refresh or the
// next write will catch up.
// Keyed on the two actions that mirror at all: `complete` is already mirrored
// inside gp-api's own transaction, so it has no lagging state to report and no
// entry to give.
const MIRROR_LAG_MESSAGE: Record<
  Exclude<TurfLifecycleAction, 'complete'>,
  string
> = {
  archive: 'Moved to archive, but your outreach history has not caught up yet.',
  restore:
    'Restored from archive, but your outreach history has not caught up yet.',
}

// Named for the action rather than a single "Something went wrong", because
// these three sit on one card and a candidate who pressed two of them needs to
// know which one did not land.
const FAILURE_MESSAGE: Record<TurfLifecycleAction, string> = {
  complete: 'This list could not be marked done. Try again.',
  archive: 'This list could not be archived. Try again.',
  restore: 'This list could not be restored. Try again.',
}

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import { CAMPAIGN_TURFS_QUERY_KEY, TURFS_QUERY_KEY } from './turfQueries'
import { turfStage } from './turfLifecycle'

// The turfs a campaign-level Done would finish on the candidate's behalf, and
// the number its confirm dialog names. Archived siblings are excluded: an
// archived turf is one the candidate has already put away, so counting it as
// outstanding work would overstate what the press is about. `turfStage` is the
// canonical read; nothing here re-derives it from the two fields.
export const unfinishedTurfs = (
  turfs: DoorKnockingTurf[],
): DoorKnockingTurf[] => turfs.filter((turf) => turfStage(turf) === 'active')

export type CampaignLifecycleAction = 'complete' | 'archive' | 'restore'

interface CampaignLifecycleCallbacks {
  onSuccess?: (turfs: DoorKnockingTurf[]) => void
}

/**
 * The campaign lifecycle: one request against N rows.
 *
 * A separate module from `turfLifecycle.ts` rather than a fourth action on it,
 * and the reason is that file's own invariant — each action there is one
 * request against one row, and `useTurfLifecycle` takes a `DoorKnockingTurf`
 * because every caller has one. A campaign is an anchor id with no row of its
 * own, and these two endpoints write every sibling's envelope in one
 * server-side transaction. Folding them in would mean a turf-or-id union on
 * the signature and an invariant sentence that is no longer true.
 *
 * Everything the two modules DO share is shared: the same two cache keys, the
 * same prefix invalidation, the same "await both before the snackbar" ordering
 * (the surface the candidate is reading has to move before the message
 * arrives), and the same refusal to be optimistic — both endpoints are
 * idempotent server-side, so a retry is cheaper than a rollback path.
 *
 * `outreachDetailQueryKey` is deliberately NOT invalidated here. It is an
 * outreach concept and this module is door knocking's, so the caller's own
 * `onSuccess` does it — the same split `turfLifecycle.ts` already has with the
 * details drawer.
 */
export const useCampaignLifecycle = (anchorOutreachId: number) => {
  const queryClient = useQueryClient()
  const { successSnackbar, errorSnackbar } = useSnackbar()

  const mutation = useMutation({
    mutationFn: async (action: CampaignLifecycleAction) => {
      if (action === 'complete') {
        const { data } = await clientRequest(
          'POST /v1/door-knocking/campaigns/:anchorId/complete',
          { anchorId: String(anchorOutreachId) },
        )
        return data
      }
      const { data } = await clientRequest(
        'POST /v1/door-knocking/campaigns/:anchorId/archive',
        { anchorId: String(anchorOutreachId), archived: action === 'archive' },
      )
      return data
    },
    onSuccess: async (_data, action) => {
      await queryClient.invalidateQueries({ queryKey: TURFS_QUERY_KEY })
      await queryClient.invalidateQueries({
        queryKey: CAMPAIGN_TURFS_QUERY_KEY,
      })
      successSnackbar(SUCCESS_MESSAGE[action])
    },
    onError: (_error, action) => {
      errorSnackbar(FAILURE_MESSAGE[action])
    },
  })

  return {
    markDone: (options?: CampaignLifecycleCallbacks) =>
      mutation.mutate('complete', options),
    moveToArchive: (options?: CampaignLifecycleCallbacks) =>
      mutation.mutate('archive', options),
    restore: (options?: CampaignLifecycleCallbacks) =>
      mutation.mutate('restore', options),
    pendingAction: mutation.isPending ? mutation.variables : null,
  }
}

const SUCCESS_MESSAGE: Record<CampaignLifecycleAction, string> = {
  complete: 'Campaign marked done',
  archive: 'Moved to archive',
  restore: 'Restored from archive',
}

// Named for the action, for the same reason `turfLifecycle`'s are: a candidate
// who pressed two of these needs to know which one did not land.
const FAILURE_MESSAGE: Record<CampaignLifecycleAction, string> = {
  complete: 'This campaign could not be marked done. Try again.',
  archive: 'This campaign could not be archived. Try again.',
  restore: 'This campaign could not be restored. Try again.',
}

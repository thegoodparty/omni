import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { outreachEventProps } from 'app/dashboard/outreach/util/outreachAnalytics'
import {
  CAMPAIGN_TURFS_QUERY_KEY,
  campaignTurfsQueryOptions,
  TURFS_QUERY_KEY,
} from './turfQueries'
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
// `isServe` is threaded in for the same reason `useTurfLifecycle` takes it:
// the one caller is the outreach details drawer, outside the door-knocking
// tree and so outside the provider that would otherwise answer this.
export const useCampaignLifecycle = (
  anchorOutreachId: number,
  isServe: boolean,
) => {
  const queryClient = useQueryClient()
  const { successSnackbar, errorSnackbar } = useSnackbar()

  const mutation = useMutation({
    mutationFn: async (action: CampaignLifecycleAction) => {
      if (action === 'complete') {
        // Snapshot which turfs this press is about to finish BEFORE the
        // request, and carry it forward — `onSuccess` must not re-read the
        // cache. `getQueryData` alone answers `undefined` for a campaign whose
        // drawer was never opened, or whose entry was GC'd after the default
        // 5-minute gcTime, and an empty snapshot fires ZERO completion events
        // with no error to notice, so a cold cache is fetched instead.
        //
        // The fetch can NEVER fail the press. It is a measurement taken on the
        // way to the write, so a 5xx or a dropped connection here falls back
        // to whatever the cache holds and then to nothing — losing the events
        // for this press, which is the cheaper of the two errors. Awaiting it
        // unguarded rejected `mutationFn` before `POST /complete` was sent and
        // told the candidate their campaign could not be marked done when the
        // request had never been attempted.
        const before = await queryClient
          .ensureQueryData(campaignTurfsQueryOptions(anchorOutreachId))
          .catch(
            () =>
              queryClient.getQueryData<DoorKnockingTurf[]>([
                ...CAMPAIGN_TURFS_QUERY_KEY,
                anchorOutreachId,
              ]) ?? [],
          )
        const finishing = new Set(unfinishedTurfs(before).map((t) => t.id))
        const { data } = await clientRequest(
          'POST /v1/door-knocking/campaigns/:anchorId/complete',
          { anchorId: String(anchorOutreachId) },
        )
        return { turfs: data, finishing }
      }
      const { data } = await clientRequest(
        'POST /v1/door-knocking/campaigns/:anchorId/archive',
        { anchorId: String(anchorOutreachId), archived: action === 'archive' },
      )
      return { turfs: data, finishing: new Set<number>() }
    },
    onSuccess: async ({ turfs, finishing }, action) => {
      // One completion event per turf this press actually finished. A
      // door-knocking campaign is many turfs under one anchor, and the TURF is
      // the list a candidate walks — the same unit phone banking's call list
      // is — so the analytics unit is the turf, not the anchor. Siblings that
      // were already done are excluded by the `finishing` snapshot the
      // mutation took before the press, since the response says only that
      // every turf is now complete, not which ones this press completed.
      if (action === 'complete') {
        for (const turf of turfs) {
          if (!finishing.has(turf.id)) continue
          trackEvent(EVENTS.Dashboard.VoterContact.CampaignCompleted, {
            ...outreachEventProps({
              channel: 'doorKnocking',
              isServe: isServe,
              campaignName: turf.name,
              recipientCount: turf.loggedCount,
              sendDate: new Date(),
              outreachCampaignId: anchorOutreachId,
              listId: turf.id,
            }),
            method: 'campaign',
          })
        }
      }
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

  // The mutation carries a `finishing` snapshot beside the turfs so the
  // completion events cannot depend on a warm cache; callers only ever wanted
  // the turfs, so it is unwrapped here rather than widening their contract.
  const run = (
    action: CampaignLifecycleAction,
    options?: CampaignLifecycleCallbacks,
  ) =>
    mutation.mutate(action, {
      onSuccess: options?.onSuccess
        ? ({ turfs }) => options.onSuccess?.(turfs)
        : undefined,
    })

  return {
    markDone: (options?: CampaignLifecycleCallbacks) =>
      run('complete', options),
    moveToArchive: (options?: CampaignLifecycleCallbacks) =>
      run('archive', options),
    restore: (options?: CampaignLifecycleCallbacks) => run('restore', options),
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

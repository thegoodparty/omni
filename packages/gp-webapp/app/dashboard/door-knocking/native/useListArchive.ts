import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { DoorKnockingTurf } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { turfsQueryOptions } from './turfQueries'

// ONE archive action for a door-knocking list, and every surface that shelves
// a list goes through it.
//
// Two rows carry an `archivedAt` for the same walk. `DoorKnockingTurf` is the
// object a candidate acts on — it exists for a Serve org, which has no campaign
// and therefore no envelope at all — and `Outreach` is the campaign-reporting
// projection of it, which is what the v2 history table's Archive toggle
// filters on. `turfService.complete` already mirrors the turf's lifecycle onto
// the envelope (`status: completed`, matched on `doorKnockingRouteId`);
// `setArchived` does not, so before this the two could silently disagree — a
// list shelved on the door-knocking rail still sitting in active outreach
// history, or the reverse.
//
// The mirror runs client-side because gp-api is frozen for this change, and it
// only works in this direction: the envelope carries `doorKnockingRouteId`, so
// turf -> route -> envelope resolves from data the door-knocking surface
// already holds, while envelope -> turf does not resolve at all — nothing maps
// a route id back to its turf without already knowing the turf. That asymmetry
// is why the outreach history drawer offers no archive on a door-knocking row:
// a second writer that could only reach the envelope is exactly the drift this
// closes.
//
// It is best-effort by construction — two writes, no transaction. The turf is
// the source of truth and is written first, so a failed mirror leaves the
// envelope stale rather than a list shelved nowhere, and `mirrorFailed` is what
// the caller says out loud instead of reporting a failed archive. The durable
// fix is the same four lines `complete` already runs, added to `setArchived`;
// see `packages/gp-api/src/outreach/AGENTS.md`.
const mirrorEnvelope = async (
  routeId: number | null,
  archived: boolean,
): Promise<void> => {
  if (routeId === null) return
  // `GET /v1/outreach` is campaign-scoped and 404s for a campaign with no
  // outreach at all, which is the same shape as "this org has no envelope" —
  // a Serve org knocks without a campaign. Neither is a failed archive, so
  // both resolve to "nothing to mirror" rather than to an error.
  const rows = await clientRequest('GET /v1/outreach', {}).catch(() => null)
  const envelope = rows?.data.find((row) => row.doorKnockingRouteId === routeId)
  if (!envelope) return
  await clientRequest('PATCH /v1/outreach/:id/archive', {
    id: String(envelope.id),
    archived,
  })
}

export interface ListArchiveResult {
  turf: DoorKnockingTurf
  // The list is shelved either way; this says the outreach history row has
  // not caught up. A different sentence from a failed archive, because
  // pressing again would only re-archive a list that already is.
  mirrorFailed: boolean
}

export const useListArchive = ({
  turfId,
  // The frozen route's id, off the serve payload the caller already holds for
  // a knocked list. Null means there is no envelope to look for, which is the
  // normal case for an org with no campaign.
  routeId,
  // The route fetch settled with nothing, so `routeId` is null for a reason
  // that is NOT "no campaign" — we simply don't know the join key. Passing it
  // as its own flag rather than letting null cover both keeps the caller from
  // reporting a clean archive over a mirror it never attempted.
  routeUnavailable = false,
  onArchived,
}: {
  turfId: number
  routeId: number | null
  routeUnavailable?: boolean
  onArchived?: (result: ListArchiveResult) => void
}) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (archived: boolean): Promise<ListArchiveResult> => {
      const { data } = await clientRequest(
        'POST /v1/door-knocking/turfs/:id/archive',
        { id: String(turfId), archived },
      )
      let mirrorFailed = routeUnavailable
      try {
        if (!routeUnavailable) await mirrorEnvelope(routeId, archived)
      } catch {
        mirrorFailed = true
      }
      return { turf: data, mirrorFailed }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: turfsQueryOptions.queryKey })
      onArchived?.(result)
    },
  })
}

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
} from '@styleguide'
import type {
  DoorKnockingMode,
  DoorKnockingTurf,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { FetchError } from 'ofetch'
import { trackEvent, EVENTS } from 'helpers/analyticsHelper'
import { RouteStep } from './createFlow/RouteStep'
import { CAMPAIGN_TURFS_QUERY_KEY, TURFS_QUERY_KEY } from './turfQueries'

// Asked at the door, which is the only moment it has an honest answer: the
// person at the top of the street knows whether they are walking it, and a
// manager cutting turfs three weeks earlier is guessing into a route nobody
// re-buys.
//
// This is where the money is now. Creating a campaign buys nothing; this
// press buys the walk ORDER for doors that were already frozen when the turf
// was drawn, which is why it cannot fail on an audience that has grown past
// the 150-stop cap since.
//
// Only opened for a turf with no route. A routed turf goes straight to its
// walk — the route is frozen and documented as never re-bought, so asking
// again would collect an answer that changes nothing.
type Props = {
  turf: Pick<DoorKnockingTurf, 'id' | 'name'> | null
  // The mode the turf's own shape argues for, when the caller knows it.
  suggested?: DoorKnockingMode | null
  onOpenChange: (open: boolean) => void
  // Handed the turf as the server returned it, routed.
  onRouteBuilt: (turf: DoorKnockingTurf) => void
}

export const StartKnockingDialog = ({
  turf,
  suggested = null,
  onOpenChange,
  onRouteBuilt,
}: Props) => {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<DoorKnockingMode>('walk')
  const [loop, setLoop] = useState(true)

  const build = useMutation({
    mutationFn: async () => {
      if (!turf) throw new Error('No turf to route')
      const res = await clientRequest(
        'POST /v1/door-knocking/turfs/:id/route',
        {
          id: String(turf.id),
          mode,
          loop,
        },
      )
      return res.data
    },
    onError: (error) => {
      // The funnel's one real failure lives here now. It used to fire from
      // the create, because the route was bought inside that transaction;
      // creating a campaign buys nothing any more, so a failed create is
      // not a failed route build and this is the only press that can be
      // one. Status separates what the candidate can act on (400 empty
      // turf or over the cap) from the vendor being down (502).
      trackEvent(EVENTS.DoorKnocking.RouteBuildFailed, {
        mode,
        loop,
        status: error instanceof FetchError ? error.status : undefined,
      })
    },
    onSuccess: (routed) => {
      // The rail and the campaign read both carry `routeSeconds`, which just
      // stopped being null for this turf.
      void queryClient.invalidateQueries({ queryKey: TURFS_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: CAMPAIGN_TURFS_QUERY_KEY })
      onRouteBuilt(routed)
    },
  })

  return (
    <Dialog
      open={turf !== null}
      onOpenChange={(open) => {
        // A press already in flight is a vendor call already made; closing
        // the dialog under it would lose the route it is about to return.
        if (build.isPending) return
        if (!open) build.reset()
        onOpenChange(open)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How are you getting there?</DialogTitle>
          <DialogDescription>
            This helps us plan the most efficient order to knock this turf.
          </DialogDescription>
        </DialogHeader>

        <RouteStep
          mode={mode}
          onModeChange={setMode}
          loop={loop}
          onLoopChange={setLoop}
          suggested={suggested}
        />

        {build.isError && (
          <p role="alert" className="text-sm text-destructive">
            We couldn&apos;t plan this route. Try again in a moment.
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={build.isPending}
          >
            Cancel
          </Button>
          {/* "Build route" rather than a second "Start knocking": the card
              that opened this dialog already says that, and the two presses
              do very different things — that one asks a question, this one
              spends money. Naming what this press does is what keeps them
              apart.

              Disabled in flight rather than merely spinning: this is a paid
              vendor call, and the cheapest guard against a double press is
              the press not being available. The server short-circuits a turf
              that already has a route, so a genuine race resolves to the
              route that exists rather than a second purchase. */}
          <Button
            onClick={() => build.mutate()}
            disabled={build.isPending}
            loading={build.isPending}
          >
            {build.isPending ? 'Building route' : 'Build route'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

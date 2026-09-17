'use client'

import { useMutation } from '@tanstack/react-query'
import { RoutePayloadTarget } from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

interface DoNotKnockControlProps {
  target: RoutePayloadTarget
  onChanged: (personId: string, doNotKnock: boolean) => void
}

// ADR 0007, now read-only-plus-Undo. The design's door carries no "Don't knock
// again", so this no longer SETS the flag — it explains a door that is already
// flagged, which is what withholds the script and the log form above it, and
// offers the one gesture that has to stay reachable from here: taking it back.
// A mis-press elsewhere is foreseeable, and the alternative is a candidate
// standing at a doorstep who has to open the CRM to undo it.
export default function DoNotKnockControl({
  target,
  onChanged,
}: DoNotKnockControlProps) {
  const clear = useMutation({
    mutationFn: () =>
      clientRequest('POST /v1/door-knocking/do-not-knock', {
        stopTargetId: target.stopTargetId,
        value: 'cleared',
      }).then((res) => res.data),
    onSuccess: (data) => {
      trackEvent(EVENTS.DoorKnocking.DoNotKnockCleared)
      onChanged(data.personId, data.doNotKnock)
    },
  })

  // Only ever rendered for a flagged resident — PersonSheet gates on the same
  // field — so there is no unflagged face to draw.
  if (!target.doNotKnock) return null

  return (
    <div className="flex flex-col gap-2 rounded-md border border-warning bg-warning/10 p-3">
      <p className="text-sm font-semibold">Do not knock</p>
      <p className="text-sm text-muted-foreground">
        This person asked not to be visited again. They stay off new lists.
      </p>
      {clear.isError && (
        <p className="text-sm text-destructive">
          That didn&rsquo;t save — try again.
        </p>
      )}
      <Button
        size="small"
        variant="outline"
        disabled={clear.isPending}
        onClick={() => clear.mutate()}
      >
        {clear.isPending ? 'Saving…' : 'Undo'}
      </Button>
    </div>
  )
}

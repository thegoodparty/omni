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

// ADR 0007. One tap, and reversible in one tap — a mis-press on a phone in the
// rain is foreseeable, and the alternative is a candidate who has to open the
// CRM to undo something they did at a doorstep.
export default function DoNotKnockControl({
  target,
  onChanged,
}: DoNotKnockControlProps) {
  const set = useMutation({
    mutationFn: (value: 'active' | 'cleared') =>
      clientRequest('POST /v1/door-knocking/do-not-knock', {
        stopTargetId: target.stopTargetId,
        value,
      }).then((res) => res.data),
    onSuccess: (data) => {
      trackEvent(
        data.doNotKnock
          ? EVENTS.DoorKnocking.DoNotKnockSet
          : EVENTS.DoorKnocking.DoNotKnockCleared,
      )
      onChanged(data.personId, data.doNotKnock)
    },
  })

  const failed = set.isError && (
    <p className="text-sm text-destructive">
      That didn&rsquo;t save — try again.
    </p>
  )

  if (target.doNotKnock) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-warning bg-warning/10 p-3">
        <p className="text-sm font-semibold">Do not knock</p>
        <p className="text-sm text-muted-foreground">
          This person asked not to be visited again. They stay off new lists.
        </p>
        {failed}
        <Button
          size="small"
          variant="outline"
          disabled={set.isPending}
          onClick={() => set.mutate('cleared')}
        >
          {set.isPending ? 'Saving…' : 'Undo'}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {failed}
      <Button
        size="small"
        variant="outline"
        disabled={set.isPending}
        onClick={() => set.mutate('active')}
      >
        {set.isPending ? 'Saving…' : 'Don’t knock again'}
      </Button>
    </div>
  )
}

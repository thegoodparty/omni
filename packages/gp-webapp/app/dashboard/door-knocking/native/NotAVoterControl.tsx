'use client'

import { useMutation } from '@tanstack/react-query'
import {
  NOT_A_VOTER_LABELS,
  NotAVoterReason,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

interface NotAVoterControlProps {
  target: RoutePayloadTarget
  onChanged: (personId: string, reason: NotAVoterReason | undefined) => void
}

const REASON_OPTIONS: Array<[NotAVoterReason, string]> = [
  ['moved', 'Moved'],
  ['deceased', 'Deceased'],
]

// The two reasons are a claim about an address and a claim about a person, and
// they are read at a door where the rest of the household still lives — so they
// get different words rather than one flag's worth. "Moved" only has to explain
// why the door is dropped; "deceased" has to survive being skimmed in the rain
// by someone about to ask for a name.
const MARKER_DETAIL: Record<NotAVoterReason, string> = {
  moved:
    'Someone here said this person no longer lives at this address. They stay off new lists.',
  deceased:
    'This person has died. Someone else in the household may answer — do not ask for them by name. They stay off new lists.',
}

// ADR 0008. Two states, one component: the marker a flagged resident carries on
// an already-frozen route, and the follow-up question behind a `not_a_voter`
// outcome. Both write the same field, and answering the question turns the
// prompt into the marker.
export default function NotAVoterControl({
  target,
  onChanged,
}: NotAVoterControlProps) {
  const set = useMutation({
    mutationFn: (value: NotAVoterReason | 'cleared') =>
      clientRequest('POST /v1/door-knocking/not-a-voter', {
        stopTargetId: target.stopTargetId,
        value,
      }).then((res) => res.data),
    onSuccess: (data) => {
      // The server's echo, never the tap: `cleared` comes back as an absent
      // key, so a request that didn't land can't leave the sheet claiming a
      // resident was flagged — or un-flagged — when they weren't.
      if (data.notAVoterReason) {
        trackEvent(EVENTS.DoorKnocking.NotAVoterReasonSet, {
          reason: data.notAVoterReason,
        })
      } else {
        trackEvent(EVENTS.DoorKnocking.NotAVoterReasonCleared)
      }
      onChanged(data.personId, data.notAVoterReason)
    },
  })

  const failed = set.isError && (
    <p className="text-sm text-destructive">
      That didn&rsquo;t save — try again.
    </p>
  )

  if (target.notAVoterReason) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-warning bg-warning/10 p-3">
        <p className="text-sm font-semibold">
          {NOT_A_VOTER_LABELS[target.notAVoterReason]}
        </p>
        <p className="text-sm text-muted-foreground">
          {MARKER_DETAIL[target.notAVoterReason]}
        </p>
        {failed}
        {/* A mis-tapped Deceased sits one button away from Moved on a phone in
            the rain, so lifting it costs the same one tap as setting it. */}
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

  // Asked only once the door is already logged as `not_a_voter`. The outcome
  // ships without a reason by design, so putting this question anywhere ahead
  // of the save would charge the quick path a third tap to record a door.
  if (target.knockStatus !== 'not_a_voter') return null

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Not a voter — what happened?
      </p>
      <div className="flex flex-wrap gap-1.5">
        {REASON_OPTIONS.map(([value, label]) => (
          <Button
            key={value}
            size="small"
            variant="outline"
            disabled={set.isPending}
            onClick={() => set.mutate(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Optional — this door is already logged.
      </p>
      {failed}
    </div>
  )
}

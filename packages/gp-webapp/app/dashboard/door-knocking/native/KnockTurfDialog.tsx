'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { DoorKnockingMode, DoorKnockingTurf } from '@goodparty_org/contracts'
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Label,
  RadioGroup,
  RadioGroupItem,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { extractApiErrorInfo } from 'helpers/extractApiErrorInfo'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { suggestTravelMode, WALKABLE_LEG_SECONDS } from './travelMode'

const KNOCK_ERROR_FALLBACK =
  'Route building failed — nothing was saved. Try again in a moment.'

// Every 4xx from this endpoint is something the candidate can act on — an
// empty turf, one over the 150-stop cap, a spent daily routing budget — and
// each arrives with its own instruction, none of which is "try again in a
// moment". A 5xx is us or the vendor, where waiting really is the advice.
const toKnockErrorMessage = (error: unknown): string =>
  (error instanceof FetchError &&
    error.status !== undefined &&
    error.status < 500 &&
    extractApiErrorInfo(error.data).message) ||
  KNOCK_ERROR_FALLBACK

const SuggestedTag = () => (
  <span className="rounded-full border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
    Suggested
  </span>
)

const SUGGESTION_REASON: Record<DoorKnockingMode, string> = {
  walk: `Suggested because every stop is within a ${WALKABLE_LEG_SECONDS / 60}-minute walk of the next one.`,
  drive: `Suggested because at least one stop is more than a ${WALKABLE_LEG_SECONDS / 60}-minute walk from the rest, so the whole list is a drive.`,
}

interface KnockTurfDialogProps {
  turf: DoorKnockingTurf
  // This turf's stops as [lng, lat], from the pack the page holds. They exist
  // before the route is bought, which is the only moment the mode is still a
  // choice — so this is what turns walk-vs-drive from a guess into a default.
  // Null while the pack or the turf's saved list is unresolved, which leaves
  // the dialog with no suggestion rather than a confident wrong one.
  stops: Array<[number, number]> | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRouteReady: (turfId: number) => void
}

export default function KnockTurfDialog({
  turf,
  stops,
  open,
  onOpenChange,
  onRouteReady,
}: KnockTurfDialogProps) {
  const queryClient = useQueryClient()
  // Derived rather than seeded into state: the pack decodes on its own
  // schedule, so a suggestion that arrives after this dialog mounts still has
  // to land. `mode` is the override once there is one, the suggestion until
  // then, and walking when there is nothing to suggest from.
  const suggested = stops ? suggestTravelMode(stops) : null
  const [override, setOverride] = useState<DoorKnockingMode | null>(null)
  const mode = override ?? suggested ?? 'walk'
  const [loop, setLoop] = useState(true)

  const knock = useMutation({
    mutationFn: () =>
      clientRequest('POST /v1/door-knocking/turfs/:id/knock', {
        id: String(turf.id),
        mode,
        loop,
      }).then((res) => res.data),
    onSuccess: (data) => {
      trackEvent(EVENTS.DoorKnocking.RouteBuilt, {
        turfId: turf.id,
        mode,
        loop,
        stopCount: data.route.stopCount,
        // Beside `mode`, this is the only read on whether the geometry-derived
        // default is any good: equal means it was accepted, different means it
        // was deliberately overruled, null means there was nothing to suggest
        // from yet.
        suggestedMode: suggested,
        // False when the turf was already knocked (by a teammate, or in
        // another tab) and gp-api returned the frozen route instead of
        // building one. No vendor call, no new route — worth telling apart.
        created: data.created,
      })
      void queryClient.invalidateQueries({ queryKey: ['door-knocking-turfs'] })
      onOpenChange(false)
      onRouteReady(turf.id)
    },
    onError: (error) => {
      trackEvent(EVENTS.DoorKnocking.RouteBuildFailed, {
        turfId: turf.id,
        mode,
        loop,
        // Separates the failures the candidate can act on (400 empty turf or
        // over the stop cap, 429 daily routing budget) from the vendor being
        // down (502) — different problems with very different fixes.
        status: error instanceof FetchError ? error.status : undefined,
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Knock {turf.name}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            This builds the route and locks the turf — the list of doors is
            frozen so everyone works from the same plan, and the directions are
            bought for the travel mode you pick. You only do this once per turf.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label>Travel mode</Label>
            <RadioGroup
              value={mode}
              onValueChange={(value) => setOverride(value as DoorKnockingMode)}
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="walk" /> Walking
                {suggested === 'walk' && <SuggestedTag />}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="drive" /> Driving
                {suggested === 'drive' && <SuggestedTag />}
              </label>
            </RadioGroup>
            {suggested && (
              <p className="text-xs text-muted-foreground">
                {SUGGESTION_REASON[suggested]}
              </p>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={loop}
              onCheckedChange={(checked) => setLoop(checked === true)}
            />
            End where I start (loop route)
          </label>
          {knock.isError && (
            <p role="alert" className="text-sm text-destructive">
              {toKnockErrorMessage(knock.error)}
            </p>
          )}
          <Button disabled={knock.isPending} onClick={() => knock.mutate()}>
            {knock.isPending ? 'Building route…' : 'Build route'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

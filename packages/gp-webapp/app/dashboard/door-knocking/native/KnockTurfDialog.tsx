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

interface KnockTurfDialogProps {
  turf: DoorKnockingTurf
  open: boolean
  onOpenChange: (open: boolean) => void
  onRouteReady: (turfId: number) => void
}

export default function KnockTurfDialog({
  turf,
  open,
  onOpenChange,
  onRouteReady,
}: KnockTurfDialogProps) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<DoorKnockingMode>('walk')
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
            frozen so everyone works from the same plan. You only do this once
            per turf.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label>Travel mode</Label>
            <RadioGroup
              value={mode}
              onValueChange={(value) => setMode(value as DoorKnockingMode)}
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="walk" /> Walking
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="drive" /> Driving
              </label>
            </RadioGroup>
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

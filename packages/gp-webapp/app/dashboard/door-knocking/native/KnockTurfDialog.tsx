'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['door-knocking-turfs'] })
      onOpenChange(false)
      onRouteReady(turf.id)
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
            <p className="text-sm text-destructive">
              Route building failed — nothing was saved. Try again in a moment.
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

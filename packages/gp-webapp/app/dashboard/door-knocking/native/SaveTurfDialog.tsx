'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { savedListsQueryOptions, TURF_COLORS } from './turfQueries'
import type { PolygonRing } from './VoterMapCanvas'

interface SaveTurfDialogProps {
  ring: PolygonRing
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export default function SaveTurfDialog({
  ring,
  open,
  onOpenChange,
  onSaved,
}: SaveTurfDialogProps) {
  const queryClient = useQueryClient()
  const listsQuery = useQuery(savedListsQueryOptions)
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(TURF_COLORS[0])
  const [listId, setListId] = useState<string>('')

  const closedRing: PolygonRing =
    ring.length > 0 &&
    (ring[0]?.[0] !== ring[ring.length - 1]?.[0] ||
      ring[0]?.[1] !== ring[ring.length - 1]?.[1])
      ? [...ring, ring[0] as [number, number]]
      : ring

  const createTurf = useMutation({
    mutationFn: () =>
      clientRequest('POST /v1/door-knocking/turfs', {
        voterFileFilterId: Number(listId),
        name: name.trim(),
        color,
        geoPoly: { type: 'Polygon', coordinates: [closedRing] },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['door-knocking-turfs'] })
      onOpenChange(false)
      setName('')
      onSaved()
    },
  })

  const canSave = name.trim().length > 0 && listId !== ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Save turf</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="turf-name">Turf name</Label>
            <Input
              id="turf-name"
              value={name}
              maxLength={120}
              placeholder="Elm St & 5th"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Voter list</Label>
            <Select value={listId} onValueChange={setListId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose the audience list" />
              </SelectTrigger>
              <SelectContent>
                {(listsQuery.data ?? []).map((list) => (
                  <SelectItem key={list.id} value={String(list.id)}>
                    {list.name || `List ${list.id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The list&apos;s filters decide who gets targeted when this turf is
              knocked — the map panel filters are preview only. Create lists
              from the Contacts page.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Color</Label>
            <div className="flex gap-2">
              {TURF_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={`Turf color ${option}`}
                  aria-pressed={color === option}
                  className={`h-7 w-7 rounded-full border-2 ${
                    color === option
                      ? 'border-foreground'
                      : 'border-transparent'
                  }`}
                  style={{ backgroundColor: option }}
                  onClick={() => setColor(option)}
                />
              ))}
            </div>
          </div>
          {createTurf.isError && (
            <p className="text-sm text-destructive">
              Saving failed — check the polygon and try again.
            </p>
          )}
          <Button
            disabled={!canSave || createTurf.isPending}
            onClick={() => createTurf.mutate()}
          >
            {createTurf.isPending ? 'Saving…' : 'Save turf'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { Badge, IconButton, Trash2Icon } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { turfsQueryOptions } from './turfQueries'

interface TurfListProps {
  onFocusTurf: (turf: DoorKnockingTurf) => void
}

export default function TurfList({ onFocusTurf }: TurfListProps) {
  const queryClient = useQueryClient()
  const turfsQuery = useQuery(turfsQueryOptions)
  const deleteTurf = useMutation({
    mutationFn: (id: number) =>
      clientRequest('DELETE /v1/door-knocking/turfs/:id', { id: String(id) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['door-knocking-turfs'] })
    },
  })

  const turfs = turfsQuery.data ?? []
  if (turfsQuery.isPending || turfs.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="text-sm font-semibold">Turfs</h2>
      {turfs.map((turf) => (
        <div
          key={turf.id}
          className="flex items-center gap-2 rounded-md border border-border p-2"
        >
          <span
            className="h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: turf.color }}
          />
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
            onClick={() => onFocusTurf(turf)}
          >
            {turf.name}
          </button>
          {turf.locked ? (
            <Badge variant="outline">Knocked</Badge>
          ) : (
            <IconButton
              aria-label={`Delete turf ${turf.name}`}
              disabled={deleteTurf.isPending}
              onClick={() => deleteTurf.mutate(turf.id)}
            >
              <Trash2Icon size={14} />
            </IconButton>
          )}
        </div>
      ))}
    </div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DOOR_KNOCK_STATUSES,
  DoorKnockingRoutePayload,
  DoorKnockStatus,
  RoutePayloadStop,
} from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { LoadingAnimation } from 'app/shared/utils/LoadingAnimation'
import { clientRequest } from 'gpApi/typed-request'
import RecordKnockForm from './RecordKnockForm'

// 'unknown' is not "never knocked" — it also covers answered-but-unsure
// (deriveKnockStatus), so the chip matches the filter panel's label.
const STATUS_LABELS: Record<DoorKnockStatus, string> = {
  unknown: 'Unknown',
  not_home: 'Not home',
  supporter: 'Supporter',
  non_supporter: 'Non-supporter',
  inaccessible: 'Inaccessible',
  refused: 'Refused',
  not_a_voter: 'Not a voter',
}

const STATUS_DOT_COLORS: Record<DoorKnockStatus, string> = {
  unknown: '#9ca3af',
  not_home: '#d97706',
  supporter: '#16a34a',
  non_supporter: '#dc2626',
  inaccessible: '#7c3aed',
  refused: '#db2777',
  not_a_voter: '#475569',
}

const StatusChip = ({ status }: { status: DoorKnockStatus }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs">
    <span
      className="h-2 w-2 rounded-full"
      style={{ backgroundColor: STATUS_DOT_COLORS[status] }}
    />
    {STATUS_LABELS[status]}
  </span>
)

const formatDuration = (seconds: number): string => {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

const formatDistance = (meters: number): string =>
  `${(meters / 1609.344).toFixed(1)} mi`

// Most-actionable-first rollup, mirroring the server's rollupStopStatus:
// an 'unknown' person keeps the whole stop knockable, and an empty stop
// rolls up to 'unknown' — no seed value, so no divergence from the server.
const rollupStatus = (statuses: DoorKnockStatus[]): DoorKnockStatus =>
  statuses.length === 0
    ? 'unknown'
    : statuses.reduce((best, status) =>
        DOOR_KNOCK_STATUSES.indexOf(status) < DOOR_KNOCK_STATUSES.indexOf(best)
          ? status
          : best,
      )

interface WalkViewProps {
  turfId: number
  turfName: string
  onBack: () => void
}

export default function WalkView({ turfId, turfName, onBack }: WalkViewProps) {
  const queryClient = useQueryClient()
  const routeQuery = useQuery({
    queryKey: ['door-knocking-route', turfId],
    queryFn: () =>
      clientRequest('GET /v1/door-knocking/turfs/:id/route', {
        id: String(turfId),
      }).then((res) => res.data),
  })
  // Recorded statuses patch the route query cache itself (not component
  // state), so they survive leaving and re-opening the walk view within the
  // cache window; a real refetch replaces them with the server's derivation.
  const applyKnockStatus = (personId: string, knockStatus: DoorKnockStatus) => {
    queryClient.setQueryData<DoorKnockingRoutePayload>(
      ['door-knocking-route', turfId],
      (old) =>
        old && {
          ...old,
          stops: old.stops.map((stop) => ({
            ...stop,
            addresses: stop.addresses.map((address) => ({
              ...address,
              targets: address.targets.map((target) =>
                target.personId === personId
                  ? { ...target, knockStatus }
                  : target,
              ),
            })),
          })),
        },
    )
  }
  const [openStopId, setOpenStopId] = useState<number | null>(null)
  const [recordingTargetId, setRecordingTargetId] = useState<number | null>(
    null,
  )
  // One replay key per target, minted when its form first opens and kept
  // across close→reopen (a remounted form must retry with the SAME key or
  // the server-side upsert can't dedupe). Cleared on success so a later,
  // genuinely new knock gets a fresh key instead of overwriting history.
  const [clientKeys, setClientKeys] = useState<Map<number, string>>(new Map())

  const toggleRecorder = (targetId: number) => {
    setClientKeys((current) =>
      current.has(targetId)
        ? current
        : new Map(current).set(targetId, crypto.randomUUID()),
    )
    setRecordingTargetId((current) => (current === targetId ? null : targetId))
  }

  const stops = useMemo(
    () => (routeQuery.data?.stops ?? []).slice().sort((a, b) => a.seq - b.seq),
    [routeQuery.data],
  )

  const stopStatus = (stop: RoutePayloadStop): DoorKnockStatus =>
    rollupStatus(
      stop.addresses.flatMap((address) =>
        address.targets.map((target) => target.knockStatus),
      ),
    )

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background p-4">
      <div className="mb-3 flex items-center gap-3">
        <Button size="small" variant="outline" onClick={onBack}>
          Back to map
        </Button>
        <h2 className="min-w-0 truncate text-lg font-semibold">{turfName}</h2>
      </div>
      {routeQuery.isPending && (
        <div className="flex flex-1 items-center justify-center">
          <LoadingAnimation />
        </div>
      )}
      {routeQuery.isError && (
        <p className="text-sm text-destructive">
          The route could not load. Refresh to try again.
        </p>
      )}
      {routeQuery.data && (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            {routeQuery.data.route.stopCount} stops ·{' '}
            {formatDuration(routeQuery.data.route.totalSeconds)} ·{' '}
            {formatDistance(routeQuery.data.route.totalMeters)} ·{' '}
            {routeQuery.data.route.mode === 'walk' ? 'walking' : 'driving'}
            {routeQuery.data.route.loop ? ' loop' : ''}
          </p>
          <ol className="flex flex-col gap-2">
            {stops.map((stop) => (
              <li key={stop.id} className="rounded-md border border-border p-3">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 text-left"
                  onClick={() =>
                    setOpenStopId(openStopId === stop.id ? null : stop.id)
                  }
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold tabular-nums">
                    {stop.seq}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {stop.displayAddress}
                    </span>
                    {stop.legSeconds > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        {formatDuration(stop.legSeconds)} from previous stop
                      </span>
                    )}
                  </span>
                  <StatusChip status={stopStatus(stop)} />
                </button>
                {openStopId === stop.id && (
                  <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                    {stop.addresses.map((address) => (
                      <div key={address.addressKey}>
                        {stop.addresses.length > 1 && (
                          <div className="mb-1 text-xs font-medium text-muted-foreground">
                            {address.address}
                          </div>
                        )}
                        <div className="flex flex-col gap-2">
                          {address.targets.map((target) => (
                            <div
                              key={target.stopTargetId}
                              className="flex flex-col gap-2"
                            >
                              <div className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-sm">
                                  {target.name ?? 'Name redacted'}
                                  {target.age !== null && (
                                    <span className="text-muted-foreground">
                                      {' '}
                                      · {target.age}
                                    </span>
                                  )}
                                  {target.politicalParty && (
                                    <span className="text-muted-foreground">
                                      {' '}
                                      · {target.politicalParty}
                                    </span>
                                  )}
                                </span>
                                <StatusChip status={target.knockStatus} />
                                <Button
                                  size="small"
                                  variant="outline"
                                  onClick={() =>
                                    toggleRecorder(target.stopTargetId)
                                  }
                                >
                                  Record
                                </Button>
                              </div>
                              {target.mayHaveMoved && (
                                <p className="text-xs text-warning">
                                  May have moved since this route was built.
                                </p>
                              )}
                              {recordingTargetId === target.stopTargetId &&
                                clientKeys.get(target.stopTargetId) !==
                                  undefined && (
                                  <RecordKnockForm
                                    target={target}
                                    clientKey={
                                      clientKeys.get(
                                        target.stopTargetId,
                                      ) as string
                                    }
                                    onRecorded={(personId, knockStatus) => {
                                      applyKnockStatus(personId, knockStatus)
                                      setClientKeys((current) => {
                                        const next = new Map(current)
                                        next.delete(target.stopTargetId)
                                        return next
                                      })
                                      setRecordingTargetId(null)
                                    }}
                                  />
                                )}
                            </div>
                          ))}
                          {address.otherResidents.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              Also at this address:{' '}
                              {address.otherResidents
                                .map((resident) => resident.name)
                                .filter(Boolean)
                                .join(', ')}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  DOOR_KNOCK_STATUSES,
  DoorKnockStatus,
  RoutePayloadStop,
} from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { LoadingAnimation } from 'app/shared/utils/LoadingAnimation'
import { clientRequest } from 'gpApi/typed-request'
import RecordKnockForm from './RecordKnockForm'

const STATUS_LABELS: Record<DoorKnockStatus, string> = {
  unknown: 'Not knocked',
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

// Most-actionable-first rollup, mirroring the server's: an 'unknown' person
// keeps the whole stop knockable.
const rollupStatus = (statuses: DoorKnockStatus[]): DoorKnockStatus =>
  statuses.reduce<DoorKnockStatus>(
    (best, status) =>
      DOOR_KNOCK_STATUSES.indexOf(status) < DOOR_KNOCK_STATUSES.indexOf(best)
        ? status
        : best,
    'not_a_voter',
  )

interface WalkViewProps {
  turfId: number
  turfName: string
  onBack: () => void
}

export default function WalkView({ turfId, turfName, onBack }: WalkViewProps) {
  const routeQuery = useQuery({
    queryKey: ['door-knocking-route', turfId],
    queryFn: () =>
      clientRequest('GET /v1/door-knocking/turfs/:id/route', {
        id: String(turfId),
      }).then((res) => res.data),
  })
  // Statuses recorded this session overlay the served ones, so dots and
  // chips recolor without refetching the route.
  const [statusOverrides, setStatusOverrides] = useState<
    Map<string, DoorKnockStatus>
  >(new Map())
  const [openStopId, setOpenStopId] = useState<number | null>(null)
  const [recordingTargetId, setRecordingTargetId] = useState<number | null>(
    null,
  )

  const statusFor = (
    personId: string,
    served: DoorKnockStatus,
  ): DoorKnockStatus => statusOverrides.get(personId) ?? served

  const stops = useMemo(
    () => (routeQuery.data?.stops ?? []).slice().sort((a, b) => a.seq - b.seq),
    [routeQuery.data],
  )

  const stopStatus = (stop: RoutePayloadStop): DoorKnockStatus =>
    rollupStatus(
      stop.addresses.flatMap((address) =>
        address.targets.map((target) =>
          statusFor(target.personId, target.knockStatus),
        ),
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
                                <StatusChip
                                  status={statusFor(
                                    target.personId,
                                    target.knockStatus,
                                  )}
                                />
                                <Button
                                  size="small"
                                  variant="outline"
                                  onClick={() =>
                                    setRecordingTargetId(
                                      recordingTargetId === target.stopTargetId
                                        ? null
                                        : target.stopTargetId,
                                    )
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
                              {recordingTargetId === target.stopTargetId && (
                                <RecordKnockForm
                                  target={target}
                                  onRecorded={(personId, knockStatus) => {
                                    setStatusOverrides((current) =>
                                      new Map(current).set(
                                        personId,
                                        knockStatus,
                                      ),
                                    )
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

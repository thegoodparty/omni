'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DOOR_KNOCK_STATUSES,
  DoorKnockingRoutePayload,
  DoorKnockStatus,
  RoutePayloadStop,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'
import { ChevronDownIcon, ChevronRightIcon } from '@styleguide'
import { LoadingAnimation } from 'app/shared/utils/LoadingAnimation'
import PersonSheet from './PersonSheet'
import { routeQueryOptions } from './turfQueries'
import { STATUS_DOT_COLORS, STATUS_LABELS } from './statusPresentation'

const formatDuration = (seconds: number): string => {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

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
}

export default function WalkView({ turfId }: WalkViewProps) {
  const queryClient = useQueryClient()
  const routeQuery = useQuery(routeQueryOptions(turfId))
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
  const [sheet, setSheet] = useState<{
    stopId: number
    targetId: number
  } | null>(null)
  // One replay key per target, minted when its form first opens and kept
  // across close→reopen (a remounted form must retry with the SAME key or
  // the server-side upsert can't dedupe). Cleared on success so a later,
  // genuinely new knock gets a fresh key instead of overwriting history.
  const [clientKeys, setClientKeys] = useState<Map<number, string>>(new Map())
  const clientKeyFor = (targetId: number): string => {
    const existing = clientKeys.get(targetId)
    if (existing) return existing
    const minted = crypto.randomUUID()
    setClientKeys((current) => new Map(current).set(targetId, minted))
    return minted
  }

  const stops = useMemo(
    () => (routeQuery.data?.stops ?? []).slice().sort((a, b) => a.seq - b.seq),
    [routeQuery.data],
  )
  const allTargets = (stopList: RoutePayloadStop[]) =>
    stopList.flatMap((stop) =>
      stop.addresses.flatMap((address) => address.targets),
    )
  const targetCount = (stopList: RoutePayloadStop[]) =>
    allTargets(stopList).length
  const reachedCount = (stopList: RoutePayloadStop[]) =>
    allTargets(stopList).filter((target) => target.knockStatus !== 'unknown')
      .length
  const statusCount = (stopList: RoutePayloadStop[], status: DoorKnockStatus) =>
    allTargets(stopList).filter((target) => target.knockStatus === status)
      .length
  const stopStatus = (stop: RoutePayloadStop): DoorKnockStatus =>
    rollupStatus(
      stop.addresses.flatMap((address) =>
        address.targets.map((target) => target.knockStatus),
      ),
    )
  const primaryTargetName = (stop: RoutePayloadStop): string | null =>
    stop.addresses[0]?.targets[0]?.name ?? null
  const targetsForStop = (stop: RoutePayloadStop): RoutePayloadTarget[] =>
    stop.addresses.flatMap((address) => address.targets)

  const sheetStop = sheet
    ? (stops.find((stop) => stop.id === sheet.stopId) ?? null)
    : null

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background px-4 py-4">
      {routeQuery.isPending && (
        <div className="flex h-full items-center justify-center">
          <LoadingAnimation />
        </div>
      )}
      {routeQuery.isError && (
        <p className="text-sm text-destructive">
          The route could not load. Refresh to try again.
        </p>
      )}
      {routeQuery.data && (
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          <div className="flex items-center justify-end gap-2 text-xs">
            <span className="rounded-full border border-border px-3 py-1.5 font-medium">
              {routeQuery.data.route.mode === 'walk' ? 'Walking' : 'Driving'}
            </span>
            {routeQuery.data.route.loop && (
              <span className="rounded-full border border-border px-3 py-1.5 font-medium">
                Loop
              </span>
            )}
          </div>

          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide">
                In this list
              </span>
              <span className="rounded-full bg-tertiary-dark px-3 py-1 text-xs font-semibold tabular-nums text-tertiary-foreground">
                {`${reachedCount(routeQuery.data.stops)}/${targetCount(
                  routeQuery.data.stops,
                )} reached`}
              </span>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-info"
                style={{
                  width: `${
                    targetCount(routeQuery.data.stops) > 0
                      ? Math.round(
                          (reachedCount(routeQuery.data.stops) /
                            targetCount(routeQuery.data.stops)) *
                            100,
                        )
                      : 0
                  }%`,
                }}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
              {DOOR_KNOCK_STATUSES.map((status) => (
                <span key={status} className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: STATUS_DOT_COLORS[status] }}
                  />
                  {STATUS_LABELS[status]}{' '}
                  <span className="tabular-nums">
                    {statusCount(routeQuery.data?.stops ?? [], status)}
                  </span>
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border">
            <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold">Stops</h3>
              <span className="text-sm tabular-nums text-muted-foreground">
                {routeQuery.data.route.stopCount} doors ·{' '}
                {formatDuration(routeQuery.data.route.totalSeconds)}
              </span>
            </div>
            <ol className="divide-y divide-border">
              {stops.map((stop) => (
                <li key={stop.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
                    onClick={() =>
                      setOpenStopId(openStopId === stop.id ? null : stop.id)
                    }
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums text-primary-foreground"
                      style={{
                        backgroundColor: STATUS_DOT_COLORS[stopStatus(stop)],
                      }}
                    >
                      {stop.seq}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {primaryTargetName(stop) ?? stop.displayAddress}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {stop.displayAddress}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="tabular-nums">
                          {targetsForStop(stop).length}
                        </span>
                        {targetsForStop(stop).map((target) => (
                          <span
                            key={target.stopTargetId}
                            className="h-1.5 w-1.5 rounded-full"
                            style={{
                              backgroundColor:
                                STATUS_DOT_COLORS[target.knockStatus],
                            }}
                          />
                        ))}
                      </span>
                    </span>
                    {stop.legSeconds > 0 && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDuration(stop.legSeconds)} walk
                      </span>
                    )}
                    {openStopId === stop.id ? (
                      <ChevronDownIcon size={16} className="shrink-0" />
                    ) : (
                      <ChevronRightIcon size={16} className="shrink-0" />
                    )}
                  </button>
                  {openStopId === stop.id && (
                    <div className="flex flex-col border-t border-border bg-muted/30">
                      {targetsForStop(stop).map((target) => (
                        <button
                          key={target.stopTargetId}
                          type="button"
                          className="flex items-center gap-2 px-4 py-2.5 pl-14 text-left text-sm hover:bg-muted/60"
                          onClick={() =>
                            setSheet({
                              stopId: stop.id,
                              targetId: target.stopTargetId,
                            })
                          }
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {target.name ?? 'Name unavailable'}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{
                                backgroundColor:
                                  STATUS_DOT_COLORS[target.knockStatus],
                              }}
                            />
                            {STATUS_LABELS[target.knockStatus]}
                          </span>
                          <ChevronRightIcon size={14} className="shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
      {sheetStop && sheet && (
        <PersonSheet
          stop={sheetStop}
          initialTargetId={sheet.targetId}
          statusFor={(target) => target.knockStatus}
          clientKeyFor={clientKeyFor}
          onRecorded={(targetId, personId, knockStatus) => {
            applyKnockStatus(personId, knockStatus)
            setClientKeys((current) => {
              const next = new Map(current)
              next.delete(targetId)
              return next
            })
            setSheet(null)
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}

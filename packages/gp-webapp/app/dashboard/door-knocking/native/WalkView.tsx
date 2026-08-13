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
import { countDoors, knockableTargets } from '../routeCounts'
import PersonSheet from './PersonSheet'
import { formatDistance } from './routeFormat'
import { routeQueryOptions } from './turfQueries'
import {
  rollupStopStatus,
  STATUS_DOT_COLORS,
  STATUS_LABELS,
} from './statusPresentation'

const formatDuration = (seconds: number): string => {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

interface WalkViewProps {
  turfId: number
  // Lets the page refetch the voter pack after the walk: the landing map's
  // statuses are baked into the cached pack, so new knocks are invisible
  // there until it reloads.
  onKnockRecorded?: () => void
}

export default function WalkView({ turfId, onKnockRecorded }: WalkViewProps) {
  const queryClient = useQueryClient()
  const routeQuery = useQuery(routeQueryOptions(turfId))
  // Recorded statuses patch the route query cache itself (not component
  // state), so they survive leaving and re-opening the walk view within the
  // cache window; a real refetch replaces them with the server's derivation.
  const patchPerson = (
    personId: string,
    patch: (target: RoutePayloadTarget) => RoutePayloadTarget,
  ) => {
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
                target.personId === personId ? patch(target) : target,
              ),
            })),
          })),
        },
    )
  }
  const applyKnockStatus = (personId: string, knockStatus: DoorKnockStatus) =>
    patchPerson(personId, (target) => ({ ...target, knockStatus }))
  // ADR 0007. Same cache patch as a knock, so the marker sticks while the
  // canvasser moves down the list; the server is the truth on refetch.
  const applyDoNotKnock = (personId: string, doNotKnock: boolean) =>
    patchPerson(personId, (target) => ({ ...target, doNotKnock }))
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
  // Keys mint in the open handler (never during render — a discarded
  // concurrent render would mint throwaway UUIDs and break replay).
  const openSheet = (stopId: number, targetIds: number[], targetId: number) => {
    setClientKeys((current) => {
      const missing = targetIds.filter((id) => !current.has(id))
      if (missing.length === 0) return current
      const next = new Map(current)
      for (const id of missing) next.set(id, crypto.randomUUID())
      return next
    })
    setSheet({ stopId, targetId })
  }
  const clientKeyFor = (targetId: number): string =>
    clientKeys.get(targetId) ?? ''

  const stops = useMemo(
    () => (routeQuery.data?.stops ?? []).slice().sort((a, b) => a.seq - b.seq),
    [routeQuery.data],
  )
  // Progress is over knockable doors only (see routeCounts). A flagged door
  // would otherwise sit under the `unknown` chip as outstanding work; its
  // recorded history, if any, still lives in the CRM.
  const targetCount = (stopList: RoutePayloadStop[]) =>
    knockableTargets(stopList).length
  const reachedCount = (stopList: RoutePayloadStop[]) =>
    knockableTargets(stopList).filter(
      (target) => target.knockStatus !== 'unknown',
    ).length
  const statusCount = (stopList: RoutePayloadStop[], status: DoorKnockStatus) =>
    knockableTargets(stopList).filter((target) => target.knockStatus === status)
      .length
  const stopStatus = rollupStopStatus
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
            {/* The offline story for v1: a canvasser walking out of signal
                takes paper. A plain link to a server-rendered page, so it
                opens and prints without this bundle. */}
            <a
              href={`/dashboard/door-knocking/print/${turfId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-border px-3 py-1.5 font-medium underline-offset-2 hover:bg-muted/50 hover:underline"
            >
              Print list
            </a>
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
                {routeQuery.data.route.stopCount} stops ·{' '}
                {countDoors(routeQuery.data.stops)} doors ·{' '}
                {formatDuration(routeQuery.data.route.totalSeconds)} ·{' '}
                {formatDistance(routeQuery.data.route.totalMeters)}
              </span>
            </div>
            <ol className="divide-y divide-border">
              {stops.map((stop) => (
                <li key={stop.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
                    onClick={() => {
                      // One resident: straight to their sheet. Several:
                      // expand so the canvasser picks (the demo's behavior).
                      const stopTargets = targetsForStop(stop)
                      if (stopTargets.length === 1 && stopTargets[0]) {
                        openSheet(
                          stop.id,
                          stopTargets.map((t) => t.stopTargetId),
                          stopTargets[0].stopTargetId,
                        )
                        return
                      }
                      setOpenStopId(openStopId === stop.id ? null : stop.id)
                    }}
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
                        {/* ADR 0007. On the collapsed row, because a
                            single-resident stop opens the sheet instead of
                            expanding — without this, the common case shows an
                            ordinary dot and the canvasser walks up to the
                            door. */}
                        {targetsForStop(stop).some(
                          (target) => target.doNotKnock,
                        ) && (
                          <span className="font-medium text-warning">
                            Do not knock
                          </span>
                        )}
                      </span>
                    </span>
                    {stop.legSeconds > 0 && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDuration(stop.legSeconds)}{' '}
                        {routeQuery.data.route.mode === 'walk'
                          ? 'walk'
                          : 'drive'}
                      </span>
                    )}
                    {targetsForStop(stop).length > 1 &&
                    openStopId === stop.id ? (
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
                            openSheet(
                              stop.id,
                              targetsForStop(stop).map((t) => t.stopTargetId),
                              target.stopTargetId,
                            )
                          }
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {target.name ?? 'Name unavailable'}
                          </span>
                          {/* ADR 0007. Read before walking up, not after
                              opening the sheet, so the marker replaces the
                              knock status rather than sitting beside it. */}
                          {target.doNotKnock ? (
                            <span className="shrink-0 text-xs font-medium text-warning">
                              Do not knock
                            </span>
                          ) : (
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
                          )}
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
            onKnockRecorded?.()
            setClientKeys((current) => {
              const next = new Map(current)
              next.delete(targetId)
              return next
            })
            setSheet(null)
          }}
          onDoNotKnockChanged={applyDoNotKnock}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}

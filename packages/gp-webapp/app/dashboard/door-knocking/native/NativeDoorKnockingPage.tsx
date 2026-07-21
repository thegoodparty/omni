'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import {
  DOOR_KNOCK_STATUSES,
  DoorKnockingTurf,
  DoorKnockStatus,
} from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { LoadingAnimation } from 'app/shared/utils/LoadingAnimation'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { Campaign } from 'helpers/types'
import type { VoterFileFilters } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import { voterPackQueryOptions } from './useVoterPack'
import { polygonStats, runFilter } from './filterEngine'
import { routeQueryOptions, turfsQueryOptions } from './turfQueries'
import CreateListFlow, { CreateFlowStep } from './createFlow/CreateListFlow'
import { filtersToDimSelections } from './createFlow/voterFilterPreview'
import KnockTurfDialog from './KnockTurfDialog'
import TurfList from './TurfList'
import WalkView from './WalkView'
import { STATUS_DOT_COLORS, STATUS_LABELS } from './statusPresentation'
import type { PolygonRing } from './VoterMapCanvas'

const VoterMapCanvas = dynamic(() => import('./VoterMapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <LoadingAnimation />
    </div>
  ),
})

interface NativeDoorKnockingPageProps {
  pathname: string
  campaign: Campaign | null
}

export default function NativeDoorKnockingPage({
  pathname,
  campaign,
}: NativeDoorKnockingPageProps) {
  const packQuery = useQuery(voterPackQueryOptions)
  const turfsQuery = useQuery(turfsQueryOptions)
  const [flowStep, setFlowStep] = useState<CreateFlowStep | null>(null)
  const [filters, setFilters] = useState<VoterFileFilters>({})
  const [ring, setRing] = useState<PolygonRing | null>(null)
  const [startDrawToken, setStartDrawToken] = useState(0)
  const [clearDrawToken, setClearDrawToken] = useState(0)
  const [focusTurf, setFocusTurf] = useState<DoorKnockingTurf | null>(null)
  const [knockTurf, setKnockTurf] = useState<DoorKnockingTurf | null>(null)
  const [walkTurf, setWalkTurf] = useState<{
    id: number
    name: string
  } | null>(null)

  // The filter draft narrows the preview only while the create flow is open;
  // the landing map always shows the whole district.
  const selections = useMemo(
    () =>
      flowStep && packQuery.data
        ? filtersToDimSelections(filters, packQuery.data.manifest)
        : new Map<string, Set<number>>(),
    [flowStep, filters, packQuery.data],
  )
  const filterResult = useMemo(
    () => (packQuery.data ? runFilter(packQuery.data, selections) : null),
    [packQuery.data, selections],
  )
  const turfStats = useMemo(
    () =>
      packQuery.data && filterResult && ring
        ? polygonStats(packQuery.data, filterResult.matchedPerDot, ring)
        : null,
    [packQuery.data, filterResult, ring],
  )
  // Landing-rail status chips: person-level counts over the whole district.
  const statusCounts = useMemo(() => {
    const counts: Partial<Record<DoorKnockStatus, number>> = {}
    const pack = packQuery.data
    const dim = pack?.manifest.dims.find((d) => d.key === 'canvassStatus')
    const plane = pack?.dimPlanes.get('canvassStatus')
    if (!pack || !dim || !plane) return counts
    const perValue = new Array<number>(dim.values.length).fill(0)
    for (let i = 0; i < plane.length; i++) {
      const value = plane[i] as number
      if (value < perValue.length) perValue[value] = (perValue[value] ?? 0) + 1
    }
    dim.values.forEach((value, index) => {
      counts[value as DoorKnockStatus] = perValue[index] ?? 0
    })
    return counts
  }, [packQuery.data])

  const walkRouteQuery = useQuery({
    ...routeQueryOptions(walkTurf?.id ?? 0),
    enabled: walkTurf !== null,
  })
  const routePins = useMemo(
    () =>
      walkTurf && walkRouteQuery.data
        ? walkRouteQuery.data.stops.map((stop) => ({
            seq: stop.seq,
            lat: stop.lat,
            lng: stop.lng,
          }))
        : [],
    [walkTurf, walkRouteQuery.data],
  )

  const changeFlowStep = (next: CreateFlowStep) => {
    if (next === 'draw' && flowStep === 'filters') {
      setStartDrawToken((token) => token + 1)
    }
    setFlowStep(next)
  }
  const closeFlow = () => {
    setFlowStep(null)
    setFilters({})
    setClearDrawToken((token) => token + 1)
  }
  const handleSaved = (drawAnother: boolean) => {
    // Clear the ring in the same batch: the canvas effect that emits null
    // runs after paint, and a committed render with the stale ring would
    // briefly enable Continue against the just-saved polygon.
    setRing(null)
    if (drawAnother) {
      // The start-draw effect wipes the previous shape itself; bumping the
      // clear token too would run deleteAll AFTER draw_polygon is entered
      // and kill the fresh drawing session.
      setFlowStep('draw')
      setStartDrawToken((token) => token + 1)
    } else {
      setFlowStep(null)
      setFilters({})
      setClearDrawToken((token) => token + 1)
    }
  }

  const rightRail = () => {
    if (walkTurf) {
      return (
        <WalkView
          turfId={walkTurf.id}
          turfName={walkTurf.name}
          onBack={() => setWalkTurf(null)}
        />
      )
    }
    // The create flow renders as a full-width overlay, not a rail.
    if (flowStep) return null
    return (
      <aside className="flex h-full w-96 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border bg-background p-4">
        <TurfList
          onFocusTurf={setFocusTurf}
          onKnockTurf={setKnockTurf}
          onOpenRoute={(turf) => setWalkTurf({ id: turf.id, name: turf.name })}
        />
        <section className="flex flex-col gap-2">
          <div>
            <h2 className="text-sm font-semibold">District voters</h2>
            {filterResult && (
              <p className="text-xs text-muted-foreground">
                {filterResult.people.toLocaleString()} voters in your district
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DOOR_KNOCK_STATUSES.map((status) => (
              <span
                key={status}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: STATUS_DOT_COLORS[status] }}
                />
                {STATUS_LABELS[status]}
                <span className="font-semibold tabular-nums">
                  {(statusCounts[status] ?? 0).toLocaleString()}
                </span>
              </span>
            ))}
          </div>
        </section>
      </aside>
    )
  }

  return (
    <DashboardLayout
      pathname={pathname}
      campaign={campaign}
      wrapperClassName="!p-0 flex flex-col"
    >
      <div className="flex h-[calc(100dvh-4rem)] w-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h1 className="text-lg font-semibold">Door knocking</h1>
          {!flowStep && !walkTurf && (
            <Button
              size="small"
              disabled={!packQuery.data}
              onClick={() => setFlowStep('filters')}
            >
              Create list
            </Button>
          )}
        </div>
        <div className="relative flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1">
            {packQuery.isPending && (
              <div className="flex h-full items-center justify-center">
                <LoadingAnimation />
              </div>
            )}
            {packQuery.isError && (
              <p className="p-4 text-sm text-destructive">
                The voter map could not load. Refresh to try again.
              </p>
            )}
            {packQuery.data && filterResult && (
              <VoterMapCanvas
                pack={packQuery.data}
                filterResult={filterResult}
                turfs={turfsQuery.data ?? []}
                routePins={routePins}
                focusTurf={focusTurf}
                startDrawToken={startDrawToken}
                clearDrawToken={clearDrawToken}
                onPolygonChange={setRing}
              />
            )}
            {flowStep === 'draw' && (
              <div className="pointer-events-none absolute left-4 top-32 max-w-xs rounded-md border border-border bg-background/95 p-3 text-sm shadow-sm">
                <p className="font-semibold">Draw your knocking boundaries</p>
                <p className="text-muted-foreground">
                  Click the map to drop boundary points, then double-click to
                  close the shape.
                </p>
              </div>
            )}
          </div>
          {rightRail()}
          {flowStep && (
            <CreateListFlow
              step={flowStep}
              filters={filters}
              onFiltersChange={setFilters}
              onStepChange={changeFlowStep}
              onClose={closeFlow}
              matchingHouseholds={filterResult?.households ?? 0}
              ring={ring}
              turfStats={turfStats}
              onSaved={handleSaved}
            />
          )}
        </div>
      </div>
      {knockTurf && (
        <KnockTurfDialog
          key={knockTurf.id}
          turf={knockTurf}
          open={true}
          onOpenChange={(open) => {
            if (!open) setKnockTurf(null)
          }}
          onRouteReady={(turfId) => {
            setKnockTurf(null)
            setWalkTurf({ id: turfId, name: knockTurf.name })
          }}
        />
      )}
    </DashboardLayout>
  )
}

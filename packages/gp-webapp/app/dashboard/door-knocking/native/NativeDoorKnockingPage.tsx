'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DOOR_KNOCK_STATUSES,
  DoorKnockingTurf,
  DoorKnockStatus,
} from '@goodparty_org/contracts'
import { ArrowLeftIcon, Button, IconButton } from '@styleguide'
import { LoadingAnimation } from 'app/shared/utils/LoadingAnimation'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { Campaign } from 'helpers/types'
import {
  INCOME_KEY_TO_RANGE,
  LANGUAGE_KEY_TO_CODE,
  type VoterFileFilters,
} from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import { voterPackQueryOptions } from './useVoterPack'
import { maskToPolygon, polygonStats, runFilter } from './filterEngine'
import {
  routeQueryOptions,
  savedListsQueryOptions,
  turfsQueryOptions,
} from './turfQueries'
import CreateListFlow, { CreateFlowStep } from './createFlow/CreateListFlow'
import {
  filtersToDimSelections,
  unpreviewableFilterKeys,
} from './createFlow/voterFilterPreview'
import KnockTurfDialog from './KnockTurfDialog'
import TurfDetailsSheet from './TurfDetailsSheet'
import TurfList from './TurfList'
import WalkView from './WalkView'
import { useWalkSession } from './useWalkSession'
import {
  rollupStatuses,
  STATUS_DOT_COLORS,
  STATUS_LABELS,
} from './statusPresentation'
import type { PolygonRing } from './VoterMapCanvas'
import { useDistrictResolution } from 'app/dashboard/shared/useDistrictResolution'
import { useOrganization } from '@shared/organization-picker'

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
  const queryClient = useQueryClient()
  // Win-only filters are hidden for an elected-office org, matching the CRM
  // wizard — gp-api rejects a contacts-made selection from one outright, so
  // offering it here would only surface as a 400 at knock time.
  const organization = useOrganization()
  const isElectedOfficial = Boolean(organization?.electedOfficeId)
  // The pack and every turf read resolve a district server-side
  // (resolveEligibleDistrictId), so without one they can only 400 — and a turf
  // cannot be drawn against a district we can't identify.
  const { isUnresolvable } = useDistrictResolution()
  const packQuery = useQuery({
    ...voterPackQueryOptions,
    enabled: !isUnresolvable,
  })
  // Owns the walk turf as well as the funnel events for the session.
  const walk = useWalkSession()
  const turfsQuery = useQuery({
    ...turfsQueryOptions,
    enabled: !isUnresolvable,
  })
  const [flowStep, setFlowStep] = useState<CreateFlowStep | null>(null)
  const [filters, setFilters] = useState<VoterFileFilters>({})
  const [ring, setRing] = useState<PolygonRing | null>(null)
  const [startDrawToken, setStartDrawToken] = useState(0)
  const [clearDrawToken, setClearDrawToken] = useState(0)
  const [drawPointCount, setDrawPointCount] = useState(0)
  const [drawHintDismissed, setDrawHintDismissed] = useState(false)
  // Landing-map legend filter: chip clicks narrow the dots to those
  // statuses. Deliberately inert while the create flow is open — the flow's
  // own filter draft drives the preview there.
  const [statusFilter, setStatusFilter] = useState<Set<DoorKnockStatus>>(
    new Set(),
  )
  const [focusTurf, setFocusTurf] = useState<DoorKnockingTurf | null>(null)
  // Landing-map turf scope: selecting a saved list shows only its dots —
  // the list's saved filters recolor, the polygon masks everything else.
  const [selectedTurf, setSelectedTurf] = useState<DoorKnockingTurf | null>(
    null,
  )
  // Renaming from the details sheet only invalidates the turfs query, and
  // `selectedTurf` is the snapshot captured when the row was clicked — read the
  // heading's name off the live row or the rail would keep showing the old one
  // after the sheet closes. Same rule TurfDetailsSheet's `liveTurf` follows:
  // the query for anything editable, the snapshot for identity and geometry.
  const selectedTurfName = selectedTurf
    ? (turfsQuery.data?.find((candidate) => candidate.id === selectedTurf.id)
        ?.name ?? selectedTurf.name)
    : null
  const savedListsQuery = useQuery(savedListsQueryOptions)
  const [knockTurf, setKnockTurf] = useState<DoorKnockingTurf | null>(null)
  const [detailsTurf, setDetailsTurf] = useState<DoorKnockingTurf | null>(null)
  const walkTurf = walk.turf

  // The filter draft narrows the preview only while the create flow is open;
  // the landing map always shows the whole district.
  const selections = useMemo(() => {
    if (!packQuery.data) return new Map<string, Set<number>>()
    if (flowStep) {
      return filtersToDimSelections(filters, packQuery.data.manifest)
    }
    if (selectedTurf) {
      const list = savedListsQuery.data?.find(
        (candidate) => candidate.id === selectedTurf.voterFileFilterId,
      )
      const listFilters = Object.fromEntries(
        Object.entries(list ?? {}).filter(
          ([, value]) => typeof value === 'boolean',
        ),
      ) as Record<string, boolean>
      // The backend stores income/language selections as string arrays, not
      // booleans — re-expand them to option keys or the scoped preview
      // silently ignores those filters.
      const rangeToKey = Object.fromEntries(
        Object.entries(INCOME_KEY_TO_RANGE).map(([key, range]) => [range, key]),
      )
      for (const range of (list?.incomeRanges as string[] | undefined) ?? []) {
        const key = rangeToKey[range]
        if (key) listFilters[key] = true
      }
      const codeToKey = Object.fromEntries(
        Object.entries(LANGUAGE_KEY_TO_CODE).map(([key, code]) => [code, key]),
      )
      for (const code of (list?.languageCodes as string[] | undefined) ?? []) {
        const key = codeToKey[code]
        if (key) listFilters[key] = true
      }
      return filtersToDimSelections(listFilters, packQuery.data.manifest)
    }
    if (statusFilter.size > 0) {
      const dim = packQuery.data.manifest.dims.find(
        (d) => d.key === 'canvassStatus',
      )
      const indexes = new Set(
        [...statusFilter]
          .map((status) => dim?.values.indexOf(status) ?? -1)
          .filter((index) => index >= 0),
      )
      if (indexes.size > 0) {
        return new Map<string, Set<number>>([['canvassStatus', indexes]])
      }
    }
    return new Map<string, Set<number>>()
  }, [
    flowStep,
    filters,
    statusFilter,
    selectedTurf,
    savedListsQuery.data,
    packQuery.data,
  ])
  const filterResult = useMemo(() => {
    if (!packQuery.data) return null
    const result = runFilter(packQuery.data, selections)
    if (!flowStep && selectedTurf) {
      return maskToPolygon(
        packQuery.data,
        result,
        (selectedTurf.geoPoly.coordinates[0] ?? []) as [number, number][],
      )
    }
    return result
  }, [packQuery.data, selections, flowStep, selectedTurf])
  // Selections the pack's buckets can't express, so the drawn preview is a
  // superset of what the list will really target. Surfaced in the create flow
  // instead of leaving the map quietly disagreeing with the filters above it.
  const unpreviewableKeys = useMemo(
    () =>
      packQuery.data
        ? unpreviewableFilterKeys(filters, packQuery.data.manifest)
        : [],
    [packQuery.data, filters],
  )
  // Unfiltered (empty selections) area stats for turf details: doors/voters
  // inside the saved polygon, regardless of the list's own filters.
  const detailsAreaStats = useMemo(
    () =>
      packQuery.data && detailsTurf
        ? polygonStats(
            packQuery.data,
            new Map(),
            (detailsTurf.geoPoly.coordinates[0] ?? []) as [number, number][],
          )
        : null,
    [packQuery.data, detailsTurf],
  )
  const turfStats = useMemo(
    () =>
      packQuery.data && ring
        ? polygonStats(packQuery.data, selections, ring)
        : null,
    [packQuery.data, selections, ring],
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
  // Pins derive color from the route query cache, which recording a knock
  // patches — so the map pin recolors the moment a door is logged.
  const routePins = useMemo(
    () =>
      walkTurf && walkRouteQuery.data
        ? walkRouteQuery.data.stops.map((stop) => ({
            seq: stop.seq,
            lat: stop.lat,
            lng: stop.lng,
            status: rollupStatuses(
              stop.addresses.flatMap((address) =>
                address.targets.map((target) => target.knockStatus),
              ),
            ),
          }))
        : [],
    [walkTurf, walkRouteQuery.data],
  )

  // Leaving the walk is the only way out of it. Doors logged along the way
  // mean the landing map's dots are stale.
  const endWalk = () => {
    const doorsLogged = walk.end({
      stopCount: walkRouteQuery.data?.route.stopCount ?? 0,
    })
    if (doorsLogged > 0) {
      void queryClient.invalidateQueries({
        queryKey: voterPackQueryOptions.queryKey,
      })
    }
  }

  const changeFlowStep = (next: CreateFlowStep) => {
    if (next === 'draw' && flowStep === 'filters') {
      setStartDrawToken((token) => token + 1)
      setDrawHintDismissed(false)
    }
    setFlowStep(next)
    setSelectedTurf(null)
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
      setDrawHintDismissed(false)
    } else {
      setFlowStep(null)
      setFilters({})
      setClearDrawToken((token) => token + 1)
    }
  }

  const rightRail = () => {
    if (walkTurf) {
      return <WalkView turfId={walkTurf.id} onKnockRecorded={walk.recordDoor} />
    }
    // The create flow renders as a full-width overlay, not a rail.
    if (flowStep) return null
    return (
      <aside className="flex h-full w-96 shrink-0 flex-col gap-5 overflow-y-auto border-l border-border bg-background p-4">
        <TurfList
          selectedTurfId={selectedTurf?.id ?? null}
          onFocusTurf={(turf) => {
            const next = selectedTurf?.id === turf.id ? null : turf
            setSelectedTurf(next)
            // The scoped branch of `selections` returns the list's own filters
            // and never reaches statusFilter, but the chips keep reading it for
            // their pressed state. Leaving it set would render a pressed chip
            // that does nothing, then silently re-narrow the map on "Show all".
            if (next) setStatusFilter(new Set())
            setFocusTurf(turf)
          }}
          onShowDetails={setDetailsTurf}
          onKnockTurf={(turf) => {
            // Knock is idempotent: a knocked turf opens its existing route,
            // an unknocked one confirms mode/loop and builds it.
            if (turf.locked)
              walk.start({ id: turf.id, name: turf.name }, 'existingRoute')
            else setKnockTurf(turf)
          }}
        />
        <section className="flex flex-col gap-2">
          <div>
            <h2 className="text-sm font-semibold">
              {selectedTurfName ?? 'District voters'}
            </h2>
            {filterResult && (
              <p className="text-xs text-muted-foreground">
                {/* The pack is rooftop-geocoded rows only (MAPPABLE_ONLY,
                    >90% of the file), so this is not the district's full
                    registration total and shouldn't read as though it were —
                    a candidate comparing it against an official count needs
                    to know why it's short. */}
                {filterResult.people.toLocaleString()}{' '}
                {selectedTurf
                  ? 'voters in this list'
                  : 'voters in your district with a mapped address'}
                {selectedTurf && (
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() => setSelectedTurf(null)}
                  >
                    Show all
                  </button>
                )}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DOOR_KNOCK_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                aria-pressed={statusFilter.has(status)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                  statusFilter.has(status)
                    ? 'border-tertiary-dark bg-tertiary-dark/10 font-medium'
                    : 'border-border'
                }`}
                onClick={() =>
                  setStatusFilter((current) => {
                    const next = new Set(current)
                    if (next.has(status)) next.delete(status)
                    else next.add(status)
                    return next
                  })
                }
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: STATUS_DOT_COLORS[status] }}
                />
                {STATUS_LABELS[status]}
                <span className="font-semibold tabular-nums">
                  {(statusCounts[status] ?? 0).toLocaleString()}
                </span>
              </button>
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
          <div className="flex min-w-0 items-center gap-2">
            {walkTurf && (
              <IconButton aria-label="Back to the map" onClick={endWalk}>
                <ArrowLeftIcon size={18} />
              </IconButton>
            )}
            <h1 className="truncate text-lg font-semibold">
              {walkTurf ? walkTurf.name : 'Door knocking'}
            </h1>
          </div>
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
        <div
          className={`relative flex min-h-0 flex-1 ${walkTurf ? 'flex-col' : ''}`}
        >
          <div
            className={
              walkTurf
                ? 'relative h-[40%] min-h-[240px] w-full shrink-0'
                : 'relative min-w-0 flex-1'
            }
          >
            {/* Before the isPending branch: a district-gated query is neither
                pending-with-a-request nor errored, so that branch would
                otherwise spin forever. */}
            {isUnresolvable && (
              <p className="p-4 text-sm text-muted-foreground">
                Voter data is not available for this office yet, so there is no
                map to draw turfs on. Contact support at help@goodparty.org and
                our team can set this up for you.
              </p>
            )}
            {!isUnresolvable && packQuery.isPending && (
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
                routeLoop={walkRouteQuery.data?.route.loop ?? false}
                routeGeometry={
                  walkTurf ? (walkRouteQuery.data?.pathGeometry ?? null) : null
                }
                focusTurf={focusTurf}
                startDrawToken={startDrawToken}
                clearDrawToken={clearDrawToken}
                onPolygonChange={setRing}
                onDrawPointCount={setDrawPointCount}
              />
            )}
            {flowStep === 'draw' &&
              !drawHintDismissed &&
              drawPointCount === 0 && (
                // The overlay swallows the dismissing click — the first tap
                // closes the card without dropping a boundary point.
                <button
                  type="button"
                  aria-label="Dismiss map instructions"
                  className="absolute inset-0 z-10 flex cursor-default items-center justify-center"
                  onClick={() => setDrawHintDismissed(true)}
                >
                  <div className="max-w-sm rounded-xl border border-border bg-background p-5 text-center shadow-lg">
                    <p className="font-semibold">
                      Draw your knocking boundaries.
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Tap on the map to drop boundary points, then drag any
                      point to outline the doors you want to knock.
                    </p>
                    <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-info">
                      Tap the map to get started
                    </p>
                  </div>
                </button>
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
              districtHouseholds={filterResult?.households ?? 0}
              ring={ring}
              turfStats={turfStats}
              onSaved={handleSaved}
              isElectedOfficial={isElectedOfficial}
              unpreviewableKeys={unpreviewableKeys}
            />
          )}
        </div>
      </div>
      {detailsTurf && (
        <TurfDetailsSheet
          turf={detailsTurf}
          areaStats={detailsAreaStats}
          onClose={() => setDetailsTurf(null)}
          onDeleted={(deleted) => {
            setDetailsTurf(null)
            // Both hold a whole turf object, not an id, so they'd go on
            // masking and framing the map to a polygon the refetched list no
            // longer contains.
            setSelectedTurf((current) =>
              current?.id === deleted.id ? null : current,
            )
            setFocusTurf((current) =>
              current?.id === deleted.id ? null : current,
            )
            // Defensive: the knock dialog is modal and the details sheet covers
            // the row that opens it, so the two can't currently be open at
            // once. Cheaper to drop the reference than to rely on that holding.
            setKnockTurf((current) =>
              current?.id === deleted.id ? null : current,
            )
          }}
        />
      )}
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
            walk.start({ id: turfId, name: knockTurf.name }, 'newRoute')
          }}
        />
      )}
    </DashboardLayout>
  )
}

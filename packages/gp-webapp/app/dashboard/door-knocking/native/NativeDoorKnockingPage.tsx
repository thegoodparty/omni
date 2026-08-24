'use client'

import { useCallback, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DoorKnockingTurf, DoorKnockStatus } from '@goodparty_org/contracts'
import { ArrowLeftIcon, Button, IconButton } from '@styleguide'
import { LoadingAnimation } from 'app/shared/utils/LoadingAnimation'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { Campaign } from 'helpers/types'
import type { VoterFileFilters } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import { voterPackQueryOptions } from './useVoterPack'
import {
  canvassStatusCounts,
  maskToPolygon,
  polygonStats,
  runFilter,
  type FilterResult,
} from './filterEngine'
import { savedListsQueryOptions, turfsQueryOptions } from './turfQueries'
import { savedListFilterKeys } from './savedListFilters'
import type { CreateFlowStep } from './createFlow/CreateListFlow'
import {
  filtersToDimSelections,
  unpreviewableDisclosureLabels,
  unpreviewableFilterKeys,
} from './createFlow/voterFilterPreview'
import { stopPositionsInRing } from './travelMode'
import KnockTurfDialog from './KnockTurfDialog'
import CreateListSurface, {
  DrawHintOverlay,
  useCreateListDraw,
} from './CreateListSurface'
import DoorKnockingManageView from './DoorKnockingManageView'
import TurfDetailsDrawer from './TurfDetailsDrawer'
import WalkSurface, { useWalkMapSession, WalkMapHint } from './WalkSurface'
import { useWalkSession } from './useWalkSession'
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

// The orchestrator for the four door-knocking surfaces (Wave 1B). What stays
// here is what the MAP reads, plus the handoffs between surfaces: each surface
// declares its own contract in its own file, and none of them reaches into this
// one. The four seams are `DoorKnockingManageView`, `CreateListSurface`,
// `TurfDetailsDrawer` and `WalkSurface` — see the section in this directory's
// AGENTS.md before changing any of their props.
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
  const walkTurf = walk.turf
  const turfsQuery = useQuery({
    ...turfsQueryOptions,
    enabled: !isUnresolvable,
  })
  const [flowStep, setFlowStep] = useState<CreateFlowStep | null>(null)
  const [filters, setFilters] = useState<VoterFileFilters>({})
  const [ring, setRing] = useState<PolygonRing | null>(null)
  // The create-list surface's half of the canvas: draw tokens, the point count
  // and the coach mark. Called here because the canvas outlives the flow.
  const draw = useCreateListDraw(flowStep)
  // The walk surface's half of the canvas: pins, the path, and a tapped pin as
  // a request to open that door.
  const walkMap = useWalkMapSession(walkTurf)
  // Landing-map legend filter: chip clicks narrow the dots to those statuses,
  // within the selected list when there is one. Deliberately inert while the
  // create flow is open — the flow's own filter draft drives the preview there.
  const [statusFilter, setStatusFilter] = useState<Set<DoorKnockStatus>>(
    new Set(),
  )
  const [focusTurf, setFocusTurf] = useState<DoorKnockingTurf | null>(null)
  // Landing-map turf scope: selecting a saved list shows only its dots —
  // the list's saved filters recolor, the polygon masks everything else.
  const [selectedTurf, setSelectedTurf] = useState<DoorKnockingTurf | null>(
    null,
  )
  // Which saved outlines are drawn. Every turf's ring rendered at once and
  // always, so an account with a dozen lists got a dozen overlapping rings and
  // no way to quiet any of them. Client-side display state in the same category
  // as `selectedTurf` and `statusFilter` — and deliberately as ephemeral as
  // they are, rather than a column or a localStorage entry: the rail row is the
  // only thing that discloses hiddenness, so a ring hidden last week and gone
  // on the next open is a map missing an outline for a reason nobody remembers
  // setting. Nothing here reaches gp-api, so no contract moves.
  //
  // "Ephemeral" covers leaving the landing map, not just closing the tab: both
  // `closeFlow` and `endWalk` clear it, because both modes unmount the manage
  // surface and with it every eye toggle, and coming back to rings you can't
  // remember quieting is the same stranding the chips are reset for. (The
  // manage surface's own sheet-open state follows the same rule for free — it
  // lives inside a surface these modes unmount.)
  //
  // `statusFilter` is the one piece that does NOT follow it, and the asymmetry
  // is deliberate: `closeFlow` clears the chips, `endWalk` keeps them. The
  // stranding rule is for state whose reason you won't remember on return, and
  // a walk is the one exit that CHANGES the statuses the chips filter on — a
  // pressed "unknown" chip showing a smaller set is the point of coming back,
  // not a leftover. Leaving the create flow changes no status, so a chip left
  // pressed there would re-narrow the district for no reason. Don't make the
  // two exits match; they differ because only one of them moves the data.
  const [hiddenTurfIds, setHiddenTurfIds] = useState<Set<number>>(new Set())
  // Renaming from the details drawer only invalidates the turfs query, and
  // `selectedTurf` is the snapshot captured when the row was clicked — read the
  // heading's name off the live row or the rail would keep showing the old one
  // after the drawer closes. Same rule TurfDetailsSheet's `liveTurf` follows:
  // the query for anything editable, the snapshot for identity and geometry.
  const selectedTurfName = selectedTurf
    ? (turfsQuery.data?.find((candidate) => candidate.id === selectedTurf.id)
        ?.name ?? selectedTurf.name)
    : null
  const savedListsQuery = useQuery(savedListsQueryOptions)
  // The knock dialog is the manage surface's handoff into the walk, so the
  // orchestrator owns it: it starts a walk session, and it is the one place
  // both modes are visible at once.
  const [knockTurf, setKnockTurf] = useState<DoorKnockingTurf | null>(null)
  const [detailsTurf, setDetailsTurf] = useState<DoorKnockingTurf | null>(null)

  // Only the outlines the rail says are shown. Hiding is display-only: the dots
  // are the pack's and are unaffected, and the rows keep their Details, PDF and
  // Knock affordances — a quiet ring is not an archived list.
  const visibleTurfs = useMemo(
    () => (turfsQuery.data ?? []).filter((turf) => !hiddenTurfIds.has(turf.id)),
    [turfsQuery.data, hiddenTurfIds],
  )
  const selectedTurfRing = useMemo(
    () =>
      selectedTurf
        ? ((selectedTurf.geoPoly.coordinates[0] ?? []) as [number, number][])
        : null,
    [selectedTurf],
  )
  // The list carrying the selected turf's filters, which is what makes the
  // rail's scope a LIST rather than a bare ring. It can be missing for three
  // unrelated reasons — still loading, the request failed, or it was deleted in
  // the CRM — and none of them means "no filters", though
  // `savedListFilterKeys(undefined)` is `{}` and every consumer below reads
  // that as exactly that. Resolving it once, here, is what stops the heading,
  // the legend chips and the dot mask from each making their own guess and
  // agreeing on the whole polygon's population under one list's name.
  const selectedList = useMemo(
    () =>
      selectedTurf
        ? savedListsQuery.data?.find(
            (candidate) => candidate.id === selectedTurf.voterFileFilterId,
          )
        : undefined,
    [savedListsQuery.data, selectedTurf],
  )
  // The pack is half of every count on this page, and "no pack yet" is a
  // different claim from "the pack failed" — one resolves itself, the other is
  // an answer. Named once because the manage surface and the details drawer
  // both have to ask, and a warm saved-list cache against a cold pack is the
  // ordinary case (Contacts populates the lists; the pack is this page's own
  // large fetch), so a surface that asks about only one of the two queries
  // calls a loading state a permanent one.
  const packPending = !packQuery.data && !packQuery.isError
  // Filters that haven't arrived versus filters that never will. The first
  // self-corrects and reads as loading; the second is a settled answer — "we
  // cannot describe this list" — and has to say so out loud, because a list
  // deleted in Contacts leaves the rail claiming the ring IS the list forever.
  // Both queries gate it: `scopeSelections` needs the manifest as much as the
  // list, so a pending pack with a settled list would otherwise fall through to
  // `scopeUnavailable` and print em dashes at something still loading.
  const scopePending =
    Boolean(selectedTurf) && (savedListsQuery.isPending || packPending)
  // The scope the rail heading names: the selected list's own saved filters,
  // or the whole district. Status chips narrow the map on top of this, and the
  // legend counts underneath describe the scope itself. `null` is the third
  // state — no honest scope — and every consumer below propagates it rather
  // than falling back on an unconstrained selection map.
  const scopeSelections = useMemo(() => {
    if (!packQuery.data) return null
    if (!selectedTurf) return new Map<string, Set<number>>()
    if (!selectedList) return null
    return filtersToDimSelections(
      savedListFilterKeys(selectedList),
      packQuery.data.manifest,
    )
  }, [packQuery.data, selectedList, selectedTurf])
  const scopeReady = scopeSelections !== null
  // Settled with nothing: the fetch failed, or the filter is gone from the CRM.
  const scopeUnavailable = Boolean(selectedTurf) && !scopeReady && !scopePending
  // The filter draft narrows the preview only while the create flow is open.
  const selections = useMemo(() => {
    if (!packQuery.data) return null
    if (flowStep) {
      return filtersToDimSelections(filters, packQuery.data.manifest)
    }
    if (!scopeSelections) return null
    const dim = packQuery.data.manifest.dims.find(
      (d) => d.key === 'canvassStatus',
    )
    const indexes = new Set(
      [...statusFilter]
        .map((status) => dim?.values.indexOf(status) ?? -1)
        .filter((index) => index >= 0),
    )
    if (indexes.size === 0) return scopeSelections
    // No saved-list filter maps onto canvassStatus, so a chip narrows the
    // scope rather than replacing it — "the not-home doors in THIS list" is
    // the reading a canvasser wants, and the chip was previously pressed-but-
    // inert whenever a list was selected.
    const narrowed = new Map(scopeSelections)
    narrowed.set('canvassStatus', indexes)
    return narrowed
  }, [flowStep, filters, statusFilter, scopeSelections, packQuery.data])
  const filterResult = useMemo<FilterResult | null>(() => {
    if (!packQuery.data) return null
    // A scope with no filters behind it shades nothing: every dot renders the
    // unmatched grey rather than letting the ring's whole population stand in
    // for a list we can't describe. The rail says which of the two states this
    // is; the map only has to avoid making the confident claim.
    if (!selections) {
      const dots = packQuery.data.manifest.counts.dots
      return {
        people: 0,
        households: 0,
        matchedPerDot: new Uint32Array(dots),
        statusPerDot: new Uint8Array(dots).fill(255),
      }
    }
    const result = runFilter(packQuery.data, selections)
    if (!flowStep && selectedTurfRing) {
      return maskToPolygon(packQuery.data, result, selectedTurfRing)
    }
    return result
  }, [packQuery.data, selections, flowStep, selectedTurfRing])
  // Selections the pack's buckets can't express, so the drawn preview is a
  // superset of what the list will really target. Surfaced in the create flow
  // instead of leaving the map quietly disagreeing with the filters above it.
  // Computed here rather than inside the flow because the manifest is the
  // page's — the map is what decodes it, and gates it on a resolvable district.
  const unpreviewableKeys = useMemo(
    () =>
      packQuery.data
        ? unpreviewableFilterKeys(filters, packQuery.data.manifest)
        : [],
    [packQuery.data, filters],
  )
  // The same disclosure for the selected list, whose filters were saved rather
  // than drafted: the rail's count is a superset for the same reason the draw
  // step's was, and the create flow's sentence is the one already written for
  // it. Only computed once the list has resolved — an unresolved scope has no
  // filters to disclose and says so instead.
  const scopeUnpreviewableLabels = useMemo(
    () =>
      packQuery.data && selectedList
        ? unpreviewableDisclosureLabels(
            unpreviewableFilterKeys(
              savedListFilterKeys(selectedList),
              packQuery.data.manifest,
            ),
          )
        : [],
    [packQuery.data, selectedList],
  )
  // Deleting is reachable from two surfaces now — the rail row and the details
  // drawer — so the page's own cleanup is named once rather than written twice.
  // These all hold a whole turf object rather than an id, so without it they
  // would go on masking and framing the map to a polygon the refetched rail no
  // longer contains.
  const handleTurfDeleted = useCallback((deleted: DoorKnockingTurf) => {
    setDetailsTurf((current) => (current?.id === deleted.id ? null : current))
    setSelectedTurf((current) => (current?.id === deleted.id ? null : current))
    setFocusTurf((current) => (current?.id === deleted.id ? null : current))
    // Defensive: the knock dialog is modal and the details drawer covers the
    // row that opens it, so these can't currently be open together. Cheaper to
    // drop the reference than to rely on that holding.
    setKnockTurf((current) => (current?.id === deleted.id ? null : current))
  }, [])
  // The knock dialog suggests walk vs drive from how spread out this list's own
  // stops are, and the pack is the only thing that knows where they are before
  // the route is bought. Same inputs as the details drawer's stats — the turf's
  // ring and its saved filters — so the suggestion is derived from exactly the
  // stop set the drawer and the draw step count. A missing list yields no stops
  // rather than the unfiltered polygon, for the same reason it yields no stats.
  const knockStops = useMemo(() => {
    const pack = packQuery.data
    if (!pack || !knockTurf) return null
    const list = savedListsQuery.data?.find(
      (candidate) => candidate.id === knockTurf.voterFileFilterId,
    )
    if (!list) return null
    return stopPositionsInRing(
      pack,
      filtersToDimSelections(savedListFilterKeys(list), pack.manifest),
      (knockTurf.geoPoly.coordinates[0] ?? []) as [number, number][],
    )
  }, [packQuery.data, savedListsQuery.data, knockTurf])
  const turfStats = useMemo(
    () =>
      packQuery.data && ring && selections
        ? polygonStats(packQuery.data, selections, ring)
        : null,
    [packQuery.data, selections, ring],
  )
  // Landing-rail status chips: person-level counts over the scope the heading
  // names, so selecting a list rescopes them with it. Memoized on the scope
  // and not on `selections`, so pressing a chip doesn't recompute them — and
  // doesn't zero out the six counts it would then be impossible to press.
  const statusCounts = useMemo(() => {
    const counts: Partial<Record<DoorKnockStatus, number>> = {}
    const pack = packQuery.data
    const dim = pack?.manifest.dims.find((d) => d.key === 'canvassStatus')
    if (!pack || !dim || !scopeSelections) return counts
    const perValue = canvassStatusCounts(
      pack,
      scopeSelections,
      selectedTurfRing,
    )
    dim.values.forEach((value, index) => {
      counts[value as DoorKnockStatus] = perValue[index] ?? 0
    })
    return counts
  }, [packQuery.data, scopeSelections, selectedTurfRing])

  // Leaving the walk is the only way out of it. Doors logged along the way
  // mean the landing map's dots are stale.
  const endWalk = () => {
    const doorsLogged = walk.end({ stopCount: walkMap.stopCount })
    if (doorsLogged > 0) {
      void queryClient.invalidateQueries({
        queryKey: voterPackQueryOptions.queryKey,
      })
    }
    // The walk replaces the manage surface outright, so the hidden rings go
    // with it — the eye toggles were unmounted for the whole walk. Same rule as
    // closeFlow, and the surface's own display state (its sheet) resets by
    // being remounted.
    setHiddenTurfIds(new Set())
    // Same stranding rule for the walk's own map state: a pin tapped on the way
    // out would reopen its sheet on the next walk, and the coach mark is
    // per-walk because each one starts on an unfamiliar route.
    walkMap.reset()
  }

  const changeFlowStep = (next: CreateFlowStep) => {
    if (next === 'draw' && flowStep === 'filters') draw.startDrawing()
    setFlowStep(next)
    setSelectedTurf(null)
  }
  // Leaving the create flow lands back on the landing map, which is a scope
  // change like any other — the chips are hidden and short-circuited while the
  // flow is open, so one left pressed on the way in would re-narrow the
  // district on the way out.
  const closeFlow = () => {
    setFlowStep(null)
    setFilters({})
    setStatusFilter(new Set())
    setHiddenTurfIds(new Set())
    draw.clearDrawing()
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
      draw.startDrawing()
    } else {
      // Saving the last list leaves by the same door as cancelling — one
      // definition of "back on the landing map" rather than two that drift.
      closeFlow()
    }
  }

  const rightRail = () => {
    if (walkTurf) {
      return (
        <WalkSurface
          turfId={walkTurf.id}
          onKnockRecorded={walk.recordDoor}
          openStopRequest={walkMap.openStopRequest}
        />
      )
    }
    // The create flow renders as a full-width overlay, not a rail.
    if (flowStep) return null
    return (
      <DoorKnockingManageView
        scope={{
          turf: selectedTurf,
          name: selectedTurfName,
          people: filterResult?.people ?? null,
          ready: scopeReady,
          pending: scopePending,
          unavailable: scopeUnavailable,
          unpreviewableLabels: scopeUnpreviewableLabels,
        }}
        statusCounts={statusCounts}
        statusFilter={statusFilter}
        hiddenTurfIds={hiddenTurfIds}
        onToggleStatus={(status) =>
          setStatusFilter((current) => {
            const next = new Set(current)
            if (next.has(status)) next.delete(status)
            else next.add(status)
            return next
          })
        }
        onSelectTurf={(turf) => {
          const next = selectedTurf?.id === turf.id ? null : turf
          setSelectedTurf(next)
          // A chip narrows within the selected list, so every scope change
          // opens unfiltered — entering one and leaving it alike. The count
          // under the heading and the legend below it then describe the same
          // audience until a chip is pressed. Carrying a chip across the
          // boundary would silently re-narrow whatever it landed in.
          setStatusFilter(new Set())
          setFocusTurf(turf)
          // Selecting a hidden list draws it again. The camera is about to
          // fly to this ring and the dots are about to mask to it, so
          // leaving the outline off would frame a boundary the candidate
          // can't see — the two controls answer different questions
          // ("which list am I reading" and "which outlines are drawn") and
          // must not end up contradicting each other.
          if (next)
            setHiddenTurfIds((current) => {
              if (!current.has(turf.id)) return current
              const remaining = new Set(current)
              remaining.delete(turf.id)
              return remaining
            })
        }}
        onClearSelection={() => {
          setSelectedTurf(null)
          setStatusFilter(new Set())
        }}
        onToggleTurfVisibility={(turf) => {
          setHiddenTurfIds((current) => {
            const next = new Set(current)
            if (next.has(turf.id)) next.delete(turf.id)
            else next.add(turf.id)
            return next
          })
          // Hiding the list the rail is describing deselects it: the
          // heading, the count, the legend and the dot mask all describe
          // the selection, so keeping it would leave the loudest thing on
          // screen pinned to a list the candidate just asked to quiet —
          // and masked to an outline that is no longer drawn.
          if (!hiddenTurfIds.has(turf.id) && selectedTurf?.id === turf.id) {
            setSelectedTurf(null)
            setStatusFilter(new Set())
          }
        }}
        onShowDetails={setDetailsTurf}
        onKnockTurf={(turf) => {
          // Knock is idempotent: a knocked turf opens its existing route,
          // an unknocked one confirms mode/loop and builds it.
          if (turf.locked)
            walk.start({ id: turf.id, name: turf.name }, 'existingRoute')
          else setKnockTurf(turf)
        }}
        onDeletedTurf={handleTurfDeleted}
      />
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
                turfs={visibleTurfs}
                routePins={walkMap.routePins}
                routeLoop={walkMap.routeLoop}
                routeGeometry={walkMap.routeGeometry}
                focusTurf={focusTurf}
                // Street level, where neighborhood street names first appear:
                // fitBounds to the whole district opens too far out to orient
                // against, and the map's job at mount is to say where you are.
                // Only the opening view — panning and turf focus own it after.
                initialZoom={16}
                startDrawToken={draw.startDrawToken}
                clearDrawToken={draw.clearDrawToken}
                undoDrawToken={draw.undoDrawToken}
                onPolygonChange={setRing}
                onDrawPointCount={draw.onPointCount}
                onRoutePinClick={walkMap.onPinTap}
              />
            )}
            <WalkMapHint visible={walkMap.hintVisible} />
            <DrawHintOverlay
              visible={draw.hintVisible}
              onDismiss={draw.dismissHint}
            />
          </div>
          {rightRail()}
          {flowStep && (
            <CreateListSurface
              step={flowStep}
              filters={filters}
              onFiltersChange={setFilters}
              onStepChange={changeFlowStep}
              onClose={closeFlow}
              districtHouseholds={filterResult?.households ?? 0}
              ring={ring}
              turfStats={turfStats}
              drawPointCount={draw.pointCount}
              onUndoPoint={draw.undoPoint}
              onClearPoints={draw.clearPoints}
              onSaved={handleSaved}
              isElectedOfficial={isElectedOfficial}
              unpreviewableKeys={unpreviewableKeys}
            />
          )}
        </div>
      </div>
      {detailsTurf && (
        <TurfDetailsDrawer
          turf={detailsTurf}
          pack={packQuery.data ?? null}
          packPending={packPending}
          onClose={() => setDetailsTurf(null)}
          onDeleted={handleTurfDeleted}
        />
      )}
      {knockTurf && (
        <KnockTurfDialog
          key={knockTurf.id}
          turf={knockTurf}
          stops={knockStops}
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

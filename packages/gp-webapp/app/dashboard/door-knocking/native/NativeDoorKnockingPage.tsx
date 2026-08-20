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
import type { SegmentResponse } from 'app/dashboard/contacts/crm/shared/contacts-types'
import { voterPackQueryOptions } from './useVoterPack'
import {
  canvassStatusCounts,
  maskToPolygon,
  polygonRoster,
  polygonStats,
  runFilter,
  type FilterResult,
} from './filterEngine'
import {
  routeQueryOptions,
  savedListsQueryOptions,
  turfsQueryOptions,
} from './turfQueries'
import CreateListFlow, { CreateFlowStep } from './createFlow/CreateListFlow'
import {
  filtersToDimSelections,
  unpreviewableDisclosureLabels,
  unpreviewableFilterKeys,
} from './createFlow/voterFilterPreview'
import { stopPositionsInRing } from './travelMode'
import KnockTurfDialog from './KnockTurfDialog'
import TurfDetailsSheet from './TurfDetailsSheet'
import TurfList from './TurfList'
import WalkView from './WalkView'
import { useWalkSession } from './useWalkSession'
import {
  rollupStopStatus,
  STATUS_DOT_COLORS,
  STATUS_LABELS,
  stopIsKnockable,
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

// A saved list's own selections, as the boolean option keys the pack preview
// speaks. The backend stores income and language as string arrays rather than
// booleans, so both have to be re-expanded or a scoped preview silently
// ignores those filters.
// How many doors the draw step's roster materializes before it stops and
// reports the rest as a count. A savable list holds at most 150 stops, so this
// covers one with a couple of doors at every stop; past it the shape is either
// over the cap or dense enough that the point of the list — is this a
// reasonable evening — is already answered. Rendering (and rebuilding, on
// every ring change) thousands of rows on a phone is what this exists to stop.
const ROSTER_DOOR_LIMIT = 200

const savedListFilterKeys = (
  list: SegmentResponse | undefined,
): Record<string, boolean> => {
  const keys = Object.fromEntries(
    Object.entries(list ?? {}).filter(
      ([, value]) => typeof value === 'boolean',
    ),
  ) as Record<string, boolean>
  const rangeToKey = Object.fromEntries(
    Object.entries(INCOME_KEY_TO_RANGE).map(([key, range]) => [range, key]),
  )
  for (const range of (list?.incomeRanges as string[] | undefined) ?? []) {
    const key = rangeToKey[range]
    if (key) keys[key] = true
  }
  const codeToKey = Object.fromEntries(
    Object.entries(LANGUAGE_KEY_TO_CODE).map(([key, code]) => [code, key]),
  )
  for (const code of (list?.languageCodes as string[] | undefined) ?? []) {
    const key = codeToKey[code]
    if (key) keys[key] = true
  }
  return keys
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
  const [undoDrawToken, setUndoDrawToken] = useState(0)
  const [drawPointCount, setDrawPointCount] = useState(0)
  const [drawHintDismissed, setDrawHintDismissed] = useState(false)
  // Whether the draw step is listing the doors it encloses. The page owns it
  // because it owns the pack: the roster is a second pass over every person,
  // and a closed panel must not pay for one on every vertex the canvas moves.
  const [rosterOpen, setRosterOpen] = useState(false)
  // Landing-map legend filter: chip clicks narrow the dots to those statuses,
  // within the selected list when there is one. Deliberately inert while the
  // create flow is open — the flow's own filter draft drives the preview there.
  const [statusFilter, setStatusFilter] = useState<Set<DoorKnockStatus>>(
    new Set(),
  )
  const [focusTurf, setFocusTurf] = useState<DoorKnockingTurf | null>(null)
  // Below lg the rail is a bottom sheet over a full-bleed map, and this is
  // whether it is pulled up. Purely a class switch, never a mount: the rail's
  // content renders at every width, so the desktop two-pane column is
  // unaffected by it and nothing has to read the viewport to decide what to
  // render (no matchMedia, no hydration mismatch).
  const [railOpen, setRailOpen] = useState(false)
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
  // "Ephemeral" covers leaving the landing map, not just closing the tab:
  // `closeFlow` and `endWalk` clear it alongside the chips and the phone sheet,
  // because both modes unmount the rail and with it every eye toggle. Coming
  // back to rings you can't remember quieting is the same stranding the chips
  // reset for, and one rule for all of this page's display state is the rule a
  // reader can predict.
  const [hiddenTurfIds, setHiddenTurfIds] = useState<Set<number>>(new Set())
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
  // an answer. Named once because the rail and the details sheet both have to
  // ask, and a warm saved-list cache against a cold pack is the ordinary case
  // (Contacts populates the lists; the pack is this page's own large fetch),
  // so a surface that asks about only one of the two queries calls a loading
  // state a permanent one.
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
  // The details sheet's pre-route stats: doors/voters inside the saved polygon
  // that the list's OWN filters keep. Computed with empty selections these
  // described everyone in the polygon while sitting right above the sheet's
  // "Applied filters" pills — a Democrats-only list reporting every person
  // inside its ring. This is the same computation the draw step ran on the
  // same shape, so Details now reproduces the number the list was saved
  // against instead of a larger one.
  // The list carrying this turf's filters, which can be missing for three
  // unrelated reasons — still loading, the request failed, or it was deleted
  // in the CRM. None of them means "no filters", but
  // `savedListFilterKeys(undefined)` is `{}`, which `polygonStats` reads as
  // exactly that and answers with every door in the ring. Resolving it here
  // makes all three produce no stats rather than the unfiltered count this
  // whole change exists to stop reporting.
  const detailsList = useMemo(
    () =>
      detailsTurf
        ? savedListsQuery.data?.find(
            (candidate) => candidate.id === detailsTurf.voterFileFilterId,
          )
        : undefined,
    [savedListsQuery.data, detailsTurf],
  )
  const detailsListStats = useMemo(
    () =>
      packQuery.data && detailsTurf && detailsList
        ? polygonStats(
            packQuery.data,
            filtersToDimSelections(
              savedListFilterKeys(detailsList),
              packQuery.data.manifest,
            ),
            (detailsTurf.geoPoly.coordinates[0] ?? []) as [number, number][],
          )
        : null,
    [packQuery.data, detailsTurf, detailsList],
  )
  // The details sheet discloses the same unshadeable selections the draw step
  // does, so it needs them for the SAVED list rather than for the draft above:
  // `unpreviewableKeys` describes whatever is being drawn right now, which is
  // nothing at all while Details is open.
  const detailsUnpreviewableKeys = useMemo(
    () =>
      packQuery.data && detailsList
        ? unpreviewableFilterKeys(
            savedListFilterKeys(detailsList),
            packQuery.data.manifest,
          )
        : [],
    [packQuery.data, detailsList],
  )
  // The knock dialog suggests walk vs drive from how spread out this list's own
  // stops are, and the pack is the only thing that knows where they are before
  // the route is bought. Same inputs as detailsListStats — the turf's ring and
  // its saved filters — so the suggestion is derived from exactly the stop set
  // the sheet and the draw step count. A missing list yields no stops rather
  // than the unfiltered polygon, for the same reason it yields no stats.
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
  // The doors behind those counts, on exactly the same inputs — the same ring,
  // the same draft selections — so the roster's own total is the doors figure
  // the step is already reporting rather than a second answer to the question.
  // It rides `ring`, which the canvas re-emits when a drag ends, so a roster
  // this long is never rebuilt mid-gesture.
  //
  // Gated on the draw step as well as on the panel, because the ring OUTLIVES
  // that step: Back keeps it and so does Continue. Without the step in the
  // condition, a panel left open and then backed out of would run a full pass
  // over every person behind a list nobody can see — and land it on the
  // filters step, whose pills recolor the dots on every tap and are the most
  // pressed control in the flow.
  const turfRoster = useMemo(
    () =>
      rosterOpen && flowStep === 'draw' && packQuery.data && ring && selections
        ? polygonRoster(packQuery.data, selections, ring, ROSTER_DOOR_LIMIT)
        : null,
    [rosterOpen, flowStep, packQuery.data, selections, ring],
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

  const walkRouteQuery = useQuery({
    ...routeQueryOptions(walkTurf?.id ?? 0),
    enabled: walkTurf !== null,
  })
  // Pins derive color from the route query cache, which recording a knock
  // patches — so the map pin recolors the moment a door is logged. The status
  // and the knockability are two answers to two questions, and the pin needs
  // both: a fully flagged stop rolls up over an empty list to the same
  // `unknown` grey as one nobody has been to, so the status alone would send a
  // canvasser to a door ADR 0007 or 0008 already told them to skip.
  const routePins = useMemo(
    () =>
      walkTurf && walkRouteQuery.data
        ? walkRouteQuery.data.stops.map((stop) => ({
            stopId: stop.id,
            seq: stop.seq,
            lat: stop.lat,
            lng: stop.lng,
            status: rollupStopStatus(stop),
            knockable: stopIsKnockable(stop),
          }))
        : [],
    [walkTurf, walkRouteQuery.data],
  )

  // A tapped pin, handed to WalkView as a request to open that stop's door —
  // the page owns the map, WalkView owns which door is open, and the sheet must
  // stay the one surface a door is logged from. The token is what lets the same
  // pin be tapped twice: closing the sheet leaves this state untouched, so a
  // bare stop id would be inert on the second tap.
  const [pinTap, setPinTap] = useState<{
    stopId: number
    token: number
  } | null>(null)
  // The walk's first-run coach mark. It names the gesture the walk map exists
  // for, and it is dismissed by that gesture — nothing else on the map has
  // anything to teach here.
  const [pinHintDismissed, setPinHintDismissed] = useState(false)

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
    // The walk replaces the rail outright, so this is the other way a phone
    // sheet gets stranded open: come back from a walk and it would spring up
    // over the map. Same reset as closeFlow, same reason — and the hidden rings
    // go with it, since the eye toggles were unmounted for the whole walk.
    setRailOpen(false)
    setHiddenTurfIds(new Set())
    // Same stranding rule as the rest of this page's display state: a pin
    // tapped on the way out would reopen its sheet on the next walk, and the
    // coach mark is per-walk because each one starts on an unfamiliar route.
    setPinTap(null)
    setPinHintDismissed(false)
  }

  const changeFlowStep = (next: CreateFlowStep) => {
    if (next === 'draw' && flowStep === 'filters') {
      setStartDrawToken((token) => token + 1)
      setDrawHintDismissed(false)
    }
    // Back to the filters is a re-cut of the audience, and the step forward
    // from it wipes the shape — so the next thing drawn is a different list
    // against a different question. A doors panel left open would spring back
    // over it with nobody having asked, which is the same stranding closeFlow
    // and endWalk reset the rail's sheet and the status chips for. Continuing
    // to confirm deliberately does NOT reset it: that is one shape being
    // reviewed, and Back has to return the step as it was left.
    if (next === 'filters') setRosterOpen(false)
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
    setClearDrawToken((token) => token + 1)
    // The doors panel is display state of the same kind, and the next create
    // flow starts with no shape to list.
    setRosterOpen(false)
    // Same reason, for the phone sheet: the rail is unmounted while the flow is
    // open, so a sheet left pulled up on the way in would spring back over the
    // map on the way out with nobody having asked for it.
    setRailOpen(false)
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
      // A saved list is finished business, so the next shape is asked about
      // from scratch — same rule as backing out to the filters.
      setRosterOpen(false)
      setStartDrawToken((token) => token + 1)
      setDrawHintDismissed(false)
    } else {
      // Saving the last list leaves by the same door as cancelling — one
      // definition of "back on the landing map" rather than two that drift.
      closeFlow()
    }
  }

  const rightRail = () => {
    if (walkTurf) {
      return (
        <WalkView
          turfId={walkTurf.id}
          onKnockRecorded={walk.recordDoor}
          openStopRequest={pinTap}
        />
      )
    }
    // The create flow renders as a full-width overlay, not a rail.
    if (flowStep) return null
    const savedListCount = turfsQuery.data?.length ?? 0
    return (
      // Below lg the rail is a bottom sheet over a full-bleed map, on the same
      // breakpoint PersonSheet switches on. It can't simply be hidden there —
      // it holds the saved lists, the legend and the scope the map is showing
      // — but a 384px column beside a 390px viewport left the map about six
      // pixels wide. Peeked it is one tap from open, and open it stops well
      // short of the top so pressing a status chip still recolors dots the
      // canvasser can see.
      <aside className="absolute inset-x-0 bottom-0 z-20 flex max-h-[60dvh] flex-col rounded-t-xl border-t border-border bg-background shadow-lg lg:static lg:h-full lg:max-h-none lg:w-96 lg:shrink-0 lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-none">
        <button
          type="button"
          aria-expanded={railOpen}
          aria-controls="door-knocking-rail"
          // Deliberately not `items-center`: globals.css carries an unlayered
          // legacy rule (`button.flex.items-center:not([data-slot])`) that
          // pins display:flex and flex-direction:row, which outranks any
          // layered utility — the pair would leave this handle laid out in a
          // row and, worse, still displayed at lg. Centering comes off the
          // children instead.
          className="flex shrink-0 flex-col gap-1.5 px-4 py-2.5 lg:hidden"
          onClick={() => setRailOpen((open) => !open)}
        >
          {/* The grab handle the create flow's drag-down sheet already uses,
              so the two sheets read as the same object. */}
          <span className="mx-auto h-1.5 w-12 rounded-full bg-muted" />
          <span className="text-center text-sm font-medium">
            {railOpen
              ? 'Hide lists and legend'
              : `Lists and legend${savedListCount > 0 ? ` · ${savedListCount}` : ''}`}
          </span>
        </button>
        <div
          id="door-knocking-rail"
          className={`min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 pt-0 lg:flex lg:pt-4 ${
            railOpen ? 'flex' : 'hidden'
          }`}
        >
          <TurfList
            selectedTurfId={selectedTurf?.id ?? null}
            hiddenTurfIds={hiddenTurfIds}
            onFocusTurf={(turf) => {
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
          />
          <section className="flex flex-col gap-2">
            <div>
              <h2 className="text-sm font-semibold">
                {selectedTurfName ?? 'District voters'}
              </h2>
              {filterResult && (
                <p
                  className={`text-xs ${
                    scopeUnavailable
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                  }`}
                >
                  {/* The heading names the selected list in all three states —
                      it is the scope the candidate picked, not a claim about
                      its size. This line is where the claim lives, so it is the
                      line that has to admit to not having one. The pack is
                      rooftop-geocoded rows only (MAPPABLE_ONLY, >90% of the
                      file), so the district figure is not its full registration
                      total and shouldn't read as though it were — a candidate
                      comparing it against an official count needs to know why
                      it's short. */}
                  {!selectedTurf
                    ? `${filterResult.people.toLocaleString()} voters in your district with a mapped address`
                    : scopePending
                      ? 'Counting the voters in this list…'
                      : scopeUnavailable
                        ? 'This list’s filters could not be loaded, so its voters can’t be counted here and none are shaded on the map. Refresh to try again — the list still targets them when you knock.'
                        : `About ${filterResult.people.toLocaleString()} voters in this list`}
                  {/* Reachable in all three states: an unresolved scope is
                      exactly the one a candidate needs a way out of. */}
                  {selectedTurf && (
                    <button
                      type="button"
                      className="ml-2 underline"
                      onClick={() => {
                        setSelectedTurf(null)
                        setStatusFilter(new Set())
                      }}
                    >
                      Show all
                    </button>
                  )}
                </p>
              )}
              {/* "About", not a hedge on the arithmetic: the count is exact for
                  what the pack can compute, and a superset of who gets knocked.
                  The gap is the PREVIEW's, never the filter's — a key the pack
                  has no bucket for adds no entry to its dim at all, so a 65+
                  list shades every age, while gp-api's own conversion bounds it
                  at `{ gte: 65 }` and knocks exactly who was asked for. Knock
                  time also applies the list's activity conditions, support
                  status and prior-contact clauses, none of which the pack
                  carries, then drops do-not-knock and not-a-voter residents.
                  So the copy says the map can't show the filter — never that
                  the filter isn't applied, which would read as targeting
                  silently failing and is the worse misunderstanding. */}
              {selectedTurf && scopeReady && (
                <p className="text-xs text-muted-foreground">
                  About, because the map can&rsquo;t show every filter this list
                  applies, and knocking also skips anyone marked do-not-knock or
                  &ldquo;not a voter&rdquo; — so you&rsquo;ll walk fewer doors
                  than this.
                </p>
              )}
              {/* The draw step's own sentence, from the same helper, so the
                  filter isn't named one way while drawing and another here. */}
              {selectedTurf &&
                scopeReady &&
                scopeUnpreviewableLabels.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    The map can&rsquo;t shade by{' '}
                    {scopeUnpreviewableLabels.join(', ')} yet, so these counts
                    include people that filter will exclude. Your saved list
                    still applies it when you knock.
                  </p>
                )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DOOR_KNOCK_STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  aria-pressed={statusFilter.has(status)}
                  // A chip narrows within the scope, so with no scope to narrow
                  // it can only flip its own pressed state and change nothing.
                  disabled={!scopeReady}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs disabled:opacity-60 ${
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
                  {/* Seven zeroes under a list's name is the same confident
                      wrong answer as one wrong total, so an unresolved scope
                      prints no number: a skeleton while it can still arrive, an
                      em dash once it can't. */}
                  {scopeReady ? (
                    <span className="font-semibold tabular-nums">
                      {(statusCounts[status] ?? 0).toLocaleString()}
                    </span>
                  ) : scopePending ? (
                    <span
                      aria-hidden="true"
                      className="h-3 w-5 animate-pulse rounded bg-muted"
                    />
                  ) : (
                    <span className="font-semibold">&mdash;</span>
                  )}
                </button>
              ))}
            </div>
          </section>
        </div>
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
                turfs={visibleTurfs}
                routePins={routePins}
                routeLoop={walkRouteQuery.data?.route.loop ?? false}
                routeGeometry={
                  walkTurf ? (walkRouteQuery.data?.pathGeometry ?? null) : null
                }
                focusTurf={focusTurf}
                // Street level, where neighborhood street names first appear:
                // fitBounds to the whole district opens too far out to orient
                // against, and the map's job at mount is to say where you are.
                // Only the opening view — panning and turf focus own it after.
                initialZoom={16}
                startDrawToken={startDrawToken}
                clearDrawToken={clearDrawToken}
                undoDrawToken={undoDrawToken}
                onPolygonChange={setRing}
                onDrawPointCount={setDrawPointCount}
                onRoutePinClick={(pin) => {
                  setPinTap((current) => ({
                    stopId: pin.stopId,
                    token: (current?.token ?? 0) + 1,
                  }))
                  setPinHintDismissed(true)
                }}
              />
            )}
            {/* The prototype's walk hint, in the prototype's words. It sits at
                the bottom of the map band, which in walk mode is the whole
                width of a shell already stacked `flex-col` with the list below
                — the sub-lg rail sheet that would otherwise cover it belongs to
                the landing map and is unmounted for the length of a walk.

                `pointer-events-none`, so unlike the draw step's full-inset
                dismiss button it can never swallow the tap it is asking for —
                there is no stray-vertex problem to solve here, and eating the
                first pin tap would make the hint the bug. It is dismissed by
                the gesture it teaches instead. */}
            {walkTurf && routePins.length > 0 && !pinHintDismissed && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-4">
                <p className="rounded-full border border-border bg-background/95 px-4 py-2 text-sm font-medium shadow-sm">
                  Tap a pin to log the door.
                </p>
              </div>
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
                  <div className="mx-4 max-w-sm rounded-xl border border-border bg-background p-5 text-center shadow-lg">
                    <p className="font-semibold">
                      Draw your knocking boundaries.
                    </p>
                    {/* Both facts a tester hunting for a Done button needs:
                        three points is the minimum, and the shape closes
                        itself. The Continue button carries them too, for
                        whoever dismissed this card on their first tap. */}
                    <p className="mt-1 text-sm text-muted-foreground">
                      Tap three or more points around the doors you want to
                      knock — the shape closes itself. Drag any point to adjust
                      it.
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
              turfRoster={turfRoster}
              rosterOpen={rosterOpen}
              onToggleRoster={() => setRosterOpen((open) => !open)}
              drawPointCount={drawPointCount}
              onUndoPoint={() => setUndoDrawToken((token) => token + 1)}
              // Clear is a fresh drawing session: the start-draw effect
              // already empties the ring and stays in draw mode, which is the
              // initial state Clear returns to. The instruction card stays
              // dismissed on purpose — it is a first-run coach mark that
              // covers the whole map, and someone who just cleared has
              // already learned the gesture.
              onClearPoints={() => setStartDrawToken((token) => token + 1)}
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
          listStats={detailsListStats}
          // Both inputs, since either one still in flight leaves the stats
          // null for a reason that resolves itself. A settled null is a
          // different claim, and the sheet makes it rather than printing 0.
          listStatsPending={packPending || savedListsQuery.isPending}
          unpreviewableKeys={detailsUnpreviewableKeys}
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

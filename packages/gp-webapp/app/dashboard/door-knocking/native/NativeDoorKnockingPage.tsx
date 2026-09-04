'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DOOR_KNOCK_STATUSES, DoorKnockingTurf } from '@goodparty_org/contracts'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@styleguide'
import { LoadingAnimation } from 'app/shared/utils/LoadingAnimation'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { Campaign } from 'helpers/types'
import type { VoterFileFilters } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import {
  districtUnavailableMessage,
  packErrorMessage,
  PACK_LOADING_DURATION,
  packLoadingTitle,
  recordLoggedKnocks,
  voterPackQueryOptions,
} from './useVoterPack'
import {
  applyLoggedKnocks,
  polygonStats,
  runFilter,
  type FilterResult,
} from './filterEngine'
import { quotaQueryOptions, turfsQueryOptions } from './turfQueries'
import { DoorKnockingSurface } from './doorKnockingSurface'
import type { CreateFlowStep } from './createFlow/CreateListFlow'
import {
  filtersToDimSelections,
  unpreviewableFilterKeys,
} from './createFlow/voterFilterPreview'
import { stopPositionsInRing } from './travelMode'
import CreateListSurface, { useCreateListDraw } from './CreateListSurface'
import TurfDetailsSheet from './TurfDetailsSheet'
import WalkSurface, { useWalkMapSession, WalkMapHint } from './WalkSurface'
import { useWalkSession } from './useWalkSession'
import { useLiveLocation } from './useLiveLocation'
import { useWalkArchive, useWalkCompletion } from './walkCompletion'
import type { PolygonRing } from './VoterMapCanvas'
import { useDistrictResolution } from 'app/dashboard/shared/useDistrictResolution'
import { useOrganization } from '@shared/organization-picker'

const VoterMapCanvas = dynamic(() => import('./VoterMapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <LoadingAnimation title="Loading the map…" />
    </div>
  ),
})

interface NativeDoorKnockingPageProps {
  pathname: string
  campaign: Campaign | null
  // A saved list carried in on `?listId=`, handed straight to the create
  // flow. Deliberately NOT read by anything on the landing map: it names the
  // audience a walk will be cut from, and the map's own scope is the rail's
  // `selectedTurf`, which is a turf and not a list.
  preselectedListId?: number
  // A turf carried in on `?walkTurfId=`, from the outreach hub's "Continue
  // knocking". Distinct from `preselectedListId` in both noun and effect: that
  // one names an audience and opens the create flow, this one names a routed
  // list and opens its walk.
  walkTurfId?: number
  // The outreach row that sent us here, so closing the walk can reopen its
  // drawer instead of dropping the candidate on a map they did not come from.
  fromOutreachId?: number
  // `?create=1` — the hub's door-knocking tile, which asks to start a walk
  // rather than to look at the rail. The tile is the only caller, so closing
  // the flow it opened goes back to the hub it was pressed on.
  openCreateFlow?: boolean
}

// Where closing the walk should put the candidate back. Each way in has a
// different "back", which is the whole reason this is tracked: leaving a walk
// resumed from the outreach hub by landing somewhere else loses the row that
// was being read.
//
// `hub` is the default and the design's own exit — `walkClose` falls through
// to `exitDoor`, which lands on Voter Outreach. It used to be `rail`, meaning
// this page's saved-lists landing surface, and meaning STAY; there is no such
// surface now, and door knocking is entered from the hub and returns to it.
type WalkOrigin =
  | { kind: 'hub' }
  | { kind: 'details'; turf: DoorKnockingTurf }
  | { kind: 'outreach'; outreachId: number }

// The hub, which is both where door knocking is entered from and where every
// exit from it lands. One route serves both surfaces, so there are two of
// them: a Serve org reaches this map from the Serve hub's door-knocking card
// and from its history rows, and `/dashboard/outreach` is not a page it may
// land on — that route redirects an org with no Campaign to the marketing
// site, so exiting a Serve walk onto it would drop the official out of the
// product entirely. Picked off `serveMode`, the same Campaign-then-
// ElectedOffice answer everything else on this page reads.
const OUTREACH_HUB = '/dashboard/outreach'
const SERVE_HUB = '/dashboard/constituent-outreach'

// How far the map's control cluster sits above the bottom edge while the
// drawing surface is up, clearing that surface's own footer bar.
const DRAW_CONTROLS_BOTTOM_PX = 96

// The orchestrator for the two door-knocking surfaces. What stays here is what
// the MAP reads, plus the handoffs between surfaces: each surface declares its
// own contract in its own file, and none of them reaches into this one. The two
// seams are `CreateListSurface` and `WalkSurface` — see the section in this
// directory's AGENTS.md before changing any of their props.
export default function NativeDoorKnockingPage({
  pathname,
  campaign,
  preselectedListId,
  walkTurfId,
  fromOutreachId,
  openCreateFlow,
}: NativeDoorKnockingPageProps) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const organization = useOrganization()
  const isElectedOfficial = Boolean(organization?.electedOfficeId)
  // Win-only filters — contacts made, political party, voter likelihood — are
  // hidden for an `eo-` org, matching the CRM wizard, because gp-api rejects
  // all three from one outright and offering them here only surfaces as a 400
  // at knock time.
  //
  // **This is the org-slug prefix and deliberately neither of the two booleans
  // beside it.** It is not `isElectedOfficial`, which is true of an org holding
  // an ElectedOffice row whatever its slug — and the server's gate
  // (`ContactsService.hasElectedOfficeAccess`) reads the slug and nothing else,
  // so that boolean would hide a party pill gp-api would happily have honoured.
  // It is not `serveMode` either: that decides which rail's LISTS are on screen
  // and a Campaign takes precedence in it, so an `eo-` org with a campaign
  // would be offered a filter its every request 400s on. What the server will
  // accept and which surface is drawn are two questions, and only one of them
  // is about the URL the request goes to.
  //
  // Nor is it the flag the surface's WORDS come from. Copy names what is on
  // screen, so it follows `serveMode` like the rest of this page's surface
  // logic: a dual-role org drawing its Win rail is looking at a Win map, and
  // calling it a constituent map would describe the wrong one. Party is the
  // only thing that follows the slug, because party is about what the server
  // will accept rather than about what is being drawn.
  const isServeOrg = Boolean(organization?.slug?.startsWith('eo-'))
  // Win or Serve, decided once here and handed down — see
  // `doorKnockingSurface.tsx` for why nothing below may re-derive it. A
  // Campaign takes precedence over an ElectedOffice, which is the same order
  // `DoorKnockingPageGate` resolves access in and the same order gp-api's
  // create endpoint chooses a scope in.
  const serveMode = !campaign && isElectedOfficial
  // Which hub this surface belongs to, and so where every exit from it lands.
  const hubPath = serveMode ? SERVE_HUB : OUTREACH_HUB
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
    ...turfsQueryOptions(serveMode),
    enabled: !isUnresolvable,
  })
  const [flowStep, setFlowStep] = useState<CreateFlowStep | null>(null)
  // Which carried list has already been handed to the create flow. Kept here
  // because the flow itself is unmounted between opens while `?listId=` stays
  // in the address bar, so this is the only place that can remember. Compared
  // by id rather than a boolean so a SECOND arrival still counts: coming back
  // to the hub and pressing the tile again with a different list re-renders
  // this page with the new id, which is not the spent one.
  const [spentPreselectId, setSpentPreselectId] = useState<number>()
  const carriedListId =
    preselectedListId === spentPreselectId ? undefined : preselectedListId
  const [filters, setFilters] = useState<VoterFileFilters>({})
  const [ring, setRing] = useState<PolygonRing | null>(null)
  // The create-list surface's half of the canvas: draw tokens, the point count
  // and the coach mark. Called here because the canvas outlives the flow.
  const draw = useCreateListDraw()
  // The walk surface's half of the canvas: pins, the path, and a tapped pin as
  // a request to open that door.
  const walkMap = useWalkMapSession(walkTurf)
  // "My live location": one watch, read by the map that draws the dot and by
  // the walk control that switched it on. Opt-in and off by default — turning
  // it on is what asks the browser for permission, so nobody gets an
  // unsolicited prompt — and it lives here rather than in the canvas because
  // the canvas is shared by all three modes while the control is the walk's
  // alone, exactly as in the design canvas.
  const [locationEnabled, setLocationEnabled] = useState(false)
  const location = useLiveLocation(locationEnabled)
  // How far off the bottom of the map the zoom/locate cluster has to sit, and
  // whether it is drawn at all. Reported by whichever surface is covering the
  // map from below — the phone's manage sheet, and the walk's — because only
  // that surface knows how tall it currently is. Held here because the canvas
  // that draws the cluster outlives all of them.
  const [mapControlsOffset, setMapControlsOffset] = useState<number | null>(16)
  // The walk session carries an id and a name, which is all the walk needs; the
  // lifecycle write needs the row itself, because `canCompleteTurf` gates on
  // `locked` and on the two timestamps. Resolved off the rail's own query so
  // the page and the card cannot disagree about which stage the list is in —
  // the same rule `selectedTurfName` above follows for the same reason.
  const walkTurfRow = walkTurf
    ? (turfsQuery.data?.find((candidate) => candidate.id === walkTurf.id) ??
      null)
    : null
  // Ending a FINISHED walk stamps the list Done. What "finished" means, and why
  // it isn't every exit, is in `walkCompletion.ts`.
  const completeFinishedWalk = useWalkCompletion(walkTurfRow)
  // The walk's own `Move to archive`. Same ref-held turf as the completion
  // above and for the same reason: the write outlives the walk it shelves.
  const walkArchive = useWalkArchive(walkTurfRow)
  const quotaQuery = useQuery(quotaQueryOptions)
  // The allowance that refused, captured when it did rather than read from the
  // query while the dialog is up: the number is in the sentence on screen, and
  // a refetch landing behind it must not rewrite what the candidate is reading.
  // Null is closed.
  const [refusedCampaignLimit, setRefusedCampaignLimit] = useState<
    number | null
  >(null)
  // Whether we are on the way out to the hub. Every exit from door knocking is
  // now a client-side navigation, and the surface being left is torn down
  // before it resolves — so without this the candidate gets a frame or two of
  // the bare map they never asked to see, which is the flash that got reported
  // as "closing the walk shows the map for a moment". It is the leaving
  // surface's own backdrop rather than a route-level loader because only this
  // page knows it is mid-exit.
  const [leaving, setLeaving] = useState(false)
  const [detailsTurf, setDetailsTurf] = useState<DoorKnockingTurf | null>(null)
  // Set at every `walk.start`, read once at `endWalk`. A ref rather than state
  // because nothing renders from it — reading it during the close is the whole
  // use — and because it must not be a dependency of the walk surface.
  const walkOrigin = useRef<WalkOrigin>({ kind: 'hub' })
  // Whether this mount has already opened the create flow. A once-guard and
  // nothing else — deliberately NOT also the record of where closing should
  // go, which is what conflating the two cost us (see the landing effect).
  const landingOpened = useRef(false)
  // Whether the flow on screen is the one `?create=1` opened, which is the
  // only thing that decides between popping the history entry the tile pushed
  // and navigating to the hub outright. Both land in the same place; `back()`
  // is the better one because it keeps the hub's scroll position.
  const tileOpened = useRef(Boolean(openCreateFlow))

  const visibleTurfs = useMemo(() => turfsQuery.data ?? [], [turfsQuery.data])
  // What the map shades. Only two surfaces can be on screen now, and only one
  // of them scopes the dots: the create flow's draft narrows them as the
  // filters are cut, and the walk leaves the whole district shaded under its
  // own route pins. The saved-list scope that used to be the third case — a
  // selected turf's filters, masked to its polygon — went with the rail that
  // was the only thing able to select one.
  const selections = useMemo(() => {
    if (!packQuery.data) return null
    if (flowStep) {
      return filtersToDimSelections(filters, packQuery.data.manifest)
    }
    return new Map<string, Set<number>>()
  }, [flowStep, filters, packQuery.data])
  const filterResult = useMemo<FilterResult | null>(
    () =>
      packQuery.data && selections
        ? applyLoggedKnocks(
            packQuery.data,
            runFilter(packQuery.data, selections),
          )
        : null,
    [packQuery.data, selections],
  )
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
  // The route step suggests walk vs drive from how spread out the drawn shape's
  // own stops are, and the pack is the only thing that knows where they are
  // before the route is bought. Since the purchase moved to the end of the
  // create flow, the shape being measured is the one on the canvas rather than
  // a saved turf's — which is also the only moment the mode is still a choice.
  const drawnStops = useMemo(() => {
    const pack = packQuery.data
    if (!pack || !ring || !selections) return null
    return stopPositionsInRing(pack, selections, ring)
  }, [packQuery.data, selections, ring])
  const turfStats = useMemo(
    () =>
      packQuery.data && ring && selections
        ? polygonStats(packQuery.data, selections, ring)
        : null,
    [packQuery.data, selections, ring],
  )
  // Leaving the walk is the only way out of it. Doors logged along the way
  // mean the landing map's dots are stale.
  const endWalk = () => {
    // Before `walk.end()` clears the session: the mutation reads the turf out
    // of this render's closure, and the row it needs is resolved from the walk
    // that is still open. A no-op unless the list has nothing left to knock.
    completeFinishedWalk()
    const doorsLogged = walk.end({ stopCount: walkMap.stopCount })
    if (doorsLogged > 0) {
      // The map's dots carry a knock status and this walk has just moved some
      // of them. This used to invalidate the pack, which re-downloaded the
      // whole district — hundreds of thousands of rows, 5-30 seconds — to
      // change a handful of status bytes, on the one gesture whose very next
      // frame is a navigation off the map. The doors are folded into the
      // cached pack instead; `applyLoggedKnocks` documents what a coordinate
      // join can and cannot say.
      //
      // The pins carry the statuses the walk itself has been recolouring, off
      // the route cache each logged knock patches, so this reads the same
      // answer the canvasser has been watching rather than a second one.
      recordLoggedKnocks(
        queryClient,
        walkMap.routePins.flatMap((pin) => {
          const status = DOOR_KNOCK_STATUSES.indexOf(pin.status)
          // 0 is `unknown`, which is a door nobody has answered for — the same
          // thing the pack already says about it.
          return status > 0 ? [{ lng: pin.lng, lat: pin.lat, status }] : []
        }),
      )
    }
    // Same stranding rule for the walk's own map state: a pin tapped on the way
    // out would reopen its sheet on the next walk, and the coach mark is
    // per-walk because each one starts on an unfamiliar route.
    walkMap.reset()
    // And the GPS radio with it. The only control that can turn this on is in
    // the walk's own row, so leaving it on would keep a watch running for a
    // surface with no way to see it and no way to stop it.
    setLocationEnabled(false)

    // Put them back where they came from. Read after the teardown above so a
    // navigation cannot preempt the completion write or the pack invalidation.
    const origin = walkOrigin.current
    walkOrigin.current = { kind: 'hub' }
    if (origin.kind === 'details') {
      setDetailsTurf(origin.turf)
      return
    }
    setLeaving(true)
    if (origin.kind === 'outreach') {
      // The hub's own consume-once deep link, the one the activity feed's
      // "View outreach" already uses — so the row reopens in its drawer rather
      // than merely being on screen somewhere in the history table. Win only:
      // the Serve hub's page takes no searchParams, so there is nothing there
      // to consume the id, and appending it would only put a param in the bar
      // that nothing reads. A Serve walk lands on its hub with the row in the
      // table instead of reopened in its drawer.
      if (!serveMode) {
        router.push(`${OUTREACH_HUB}?outreachId=${origin.outreachId}`)
        return
      }
    }
    // The design's own exit. Staying would land on a bare map with no surface
    // on it and no control to make one, which is what the rail used to be for;
    // the campaign that was just walked is a row on the hub.
    router.push(hubPath)
  }

  // Every list has its route from the moment it exists, so Knock is now
  // exactly "open the walk" — no dialog, no purchase, no branch. Named once
  // because three surfaces reach it: the rail card's Knock, the details
  // drawer's Start knocking, and the outreach hub's Continue knocking through
  // the deep link below. Each passes where closing should return to.
  const startKnocking = (turf: DoorKnockingTurf, origin: WalkOrigin) => {
    walkOrigin.current = origin
    walk.start({ id: turf.id, name: turf.name }, 'existingRoute')
  }

  // `?walkTurfId=` — the outreach hub's "Continue knocking". Consume-once by
  // the same convention the hub's own deep link follows (ENG-10769): strip the
  // param, then act, so a back-navigation cannot reopen a walk that was closed.
  // Waits on the turf query rather than starting from the id alone, because the
  // walk's own header needs the list's name, and a walk of a list that does
  // not exist is not something to put on screen.
  const consumedWalkTurfId = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (walkTurfId === undefined || walkTurfId === consumedWalkTurfId.current) {
      return
    }
    const turf = turfsQuery.data?.find(
      (candidate) => candidate.id === walkTurfId,
    )
    if (!turf) return
    consumedWalkTurfId.current = walkTurfId
    router.replace('/dashboard/door-knocking', { scroll: false })
    walkOrigin.current =
      fromOutreachId === undefined
        ? { kind: 'hub' }
        : { kind: 'outreach', outreachId: fromOutreachId }
    walk.start({ id: turf.id, name: turf.name }, 'existingRoute')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkTurfId, fromOutreachId, turfsQuery.data, router])

  // A `?walkTurfId=` this org can never open a walk for. Settled rather than
  // successful, so a failed turf read counts too: the alternative is deferring
  // to a query that is not coming back. Until it settles the link is merely
  // slow, and a list that arrives late still gets its walk — the effect above
  // only spends the id once it has found a turf.
  const deadWalkLink =
    walkTurfId !== undefined &&
    consumedWalkTurfId.current === undefined &&
    turfsQuery.isFetched &&
    !turfsQuery.data?.some((candidate) => candidate.id === walkTurfId)

  // Every way into the create flow goes through here, because the daily
  // campaign allowance refuses the FLOW and not the press at the end of it —
  // a candidate who is told after drawing a boundary and naming a walk has
  // lost work that a reload would not bring back.
  //
  // An allowance that hasn't answered yet, or failed to, opens the flow: the
  // two asserts inside the create transaction are the authority either way,
  // and refusing on a read we don't have would lock the feature whenever this
  // one query is down.
  const beginCreateFlow = useCallback((): boolean => {
    const quota = quotaQuery.data
    if (quota && quota.campaignsRemaining === 0) {
      setRefusedCampaignLimit(quota.campaignLimit)
      return false
    }
    setFlowStep('filters')
    return true
  }, [quotaQuery.data])

  // Arriving here IS asking to build a campaign. There is no landing surface
  // to choose from any more — the saved-lists rail is gone, and door knocking
  // is entered from the hub — so the flow opens itself however the page was
  // reached, whether the tile sent us with `?create=1` or the URL was typed.
  //
  // It waits on the allowance, because an opener that fires before that query
  // settles walks straight past the limit: the guard below is spent on the
  // first paint, so a refusal arriving a moment later would find the flow
  // already open and return early. Waiting costs nothing, since nothing is on
  // screen either way. A failed read is settled and opens the flow, which is
  // the point — only a read still in flight defers.
  //
  // A walk carried in on `?walkTurfId=` wins: the two params ask for different
  // things and only one surface can be on screen.
  //
  // `landingOpened` is spent for the life of the mount and is NEVER unset —
  // that is load-bearing. It used to be cleared when a list was created, and
  // creating one invalidates the allowance, which re-ran this effect against a
  // turf list that had not refetched yet and reopened the flow at step one on
  // top of the walk that had just started.
  useEffect(() => {
    if (landingOpened.current) return
    // Three ways of asking "is a walk what we were sent here for?", and all
    // three are needed. The param is the request; `consumedWalkTurfId` is that
    // request already spent, which matters because consuming it REPLACES the
    // URL and hands this effect a `walkTurfId` of undefined a render later —
    // on its own, the param check would let the create flow open on top of the
    // walk the deep link had just started. `walkTurf` covers the session
    // outliving both.
    //
    // A request that CANNOT be honoured is not a reason to defer, though: it
    // used to be safe to sit on a dead deep link because the rail was behind
    // it, and now there is nothing there — so a stale bookmark, a list deleted
    // in the CRM or another org's id would hold a bare map with no surface on
    // it and no control to make one. Treated as an ordinary arrival instead.
    if (walkTurfId !== undefined && !deadWalkLink) return
    if (consumedWalkTurfId.current !== undefined || walkTurf) return
    if (isUnresolvable || quotaQuery.isPending) return
    // Marked spent either way: an org that is out of campaigns gets the limit
    // dialog, and re-firing would reopen it every time it was dismissed.
    landingOpened.current = true
    beginCreateFlow()
  }, [
    walkTurfId,
    deadWalkLink,
    walkTurf,
    isUnresolvable,
    quotaQuery.isPending,
    beginCreateFlow,
  ])

  const changeFlowStep = (next: CreateFlowStep) => {
    if (next === 'draw' && flowStep === 'filters') draw.startDrawing()
    setFlowStep(next)
  }
  // Backing out with nothing saved. There is no map behind this worth landing
  // on — the rail is gone — so closing the flow leaves door knocking, exactly
  // as closing the walk does.
  const closeFlow = () => {
    setFlowStep(null)
    setFilters({})
    draw.clearDrawing()
    setLeaving(true)
    // Pressed the tile, changed their mind. `back()` rather than a path,
    // because it returns to the hub scrolled where they left it — and the tile
    // exists on both the Win hub and the Serve one, so it is right for either
    // without asking which. Typed URLs have no such entry to pop and get this
    // surface's own hub instead.
    if (tileOpened.current) {
      tileOpened.current = false
      router.back()
      return
    }
    router.push(hubPath)
  }
  // The whole chain committed. The design hands straight over to the walk
  // rather than returning to the rail: the list was created to be knocked, and
  // its route is already bought and frozen.
  const handleListCreated = (turf: DoorKnockingTurf) => {
    // Clear the ring in the same batch: the canvas effect that emits null runs
    // after paint, and a committed render with the stale ring would briefly
    // enable Continue against the just-saved polygon.
    setRing(null)
    // Spent: the walk owns the screen now, and closing it exits to the hub on
    // its own terms rather than popping the history entry the tile pushed.
    // `landingOpened` is deliberately left set — see the landing effect.
    tileOpened.current = false
    setFlowStep(null)
    setFilters({})
    draw.clearDrawing()
    walkOrigin.current = { kind: 'hub' }
    walk.start({ id: turf.id, name: turf.name }, 'newRoute')
  }
  // Two surfaces, and only one of them can be on screen. There is no third
  // "landing" case any more: the walk is the only thing that renders beside
  // the create flow, and the flow draws itself as a full-width overlay below
  // rather than as a rail.
  const walkSurface = () =>
    walkTurf ? (
      <WalkSurface
        turfId={walkTurf.id}
        turfName={walkTurf.name}
        onExit={endWalk}
        // Shelving is leaving: the walk closes once the write settles rather
        // than sitting on a route that has been archived under it. A failed
        // archive has already said so in a snackbar.
        onMoveToArchive={() => walkArchive.moveToArchive(endWalk)}
        archivePending={walkArchive.pending}
        onMapControlsOffsetChange={setMapControlsOffset}
        onKnockRecorded={walk.recordDoor}
        openStopRequest={walkMap.openStopRequest}
        selectedStopId={walkMap.selectedStopId}
        onSelectStop={walkMap.selectStop}
        liveLocation={location}
      />
    ) : null

  // `officeName` is the Serve door script's opener, read at this level because
  // it is the only one that can: the organization provider is above this page
  // and `useOrganization` throws below it. Win ignores it — its intro names the
  // office the campaign is FOR, which the campaign row already carries.
  return (
    <DoorKnockingSurface
      serveMode={serveMode}
      officeName={organization?.positionName ?? ''}
    >
      <DashboardLayout
        pathname={pathname}
        campaign={campaign}
        // This page is a full-bleed map with a floating card over it, so it has
        // to be EXACTLY the height left by the dashboard chrome — scrolling
        // belongs inside the card, never on the document.
        //
        // `min-h-0` is what makes that true without naming a number. The wrapper
        // is `flex-1` inside `SidebarInset`, which is `flex-1` inside
        // `SidebarProvider`'s `min-h-svh` row; a flex item's default
        // `min-height: auto` lets its CONTENT set the floor, so anything the
        // layout put beside this page pushed the document past the window (see
        // the chat spacer below). With the floor removed the
        // chain resolves the other way — the row settles at `min-h-svh` and the
        // wrapper takes what the chrome above it leaves, whatever that is at
        // this width. It replaces an `h-[calc(100dvh-4rem)]` on the child below,
        // which hard-coded the mobile top bar's height and was wrong at `lg`,
        // where that bar is `lg:hidden`: the map ended 64px short of the bottom
        // of the window on every desktop.
        //
        // This is also what makes `DashboardLayout`'s own siblings behave. On
        // Win (campaign) orgs, `DashboardCampaignManagerChat` renders
        // an in-flow `h-24` spacer next to this page, reserving room for its
        // fixed footer bar. Against a child with a hard viewport height that
        // spacer was 96px of pure overflow and the page scrolled by exactly
        // that; against `h-full` it is honoured INSIDE the window instead — the
        // map stops 96px short and the bar sits in the gap rather than over the
        // map. Nothing here reaches into the layout every dashboard page shares.
        //
        // `overflow-hidden` is the guard for the case that reservation cannot be
        // met: if a sibling ever exceeds the window the map is squeezed to
        // nothing rather than the document growing a scrollbar again.
        //
        // `svh` rather than `dvh` is inherited from `SidebarProvider`, and is
        // the right value here: `svh` is the viewport with mobile browser chrome
        // at its largest, so the page is whole in every chrome state — and since
        // the document can no longer scroll, the chrome never retracts, which
        // leaves `dvh` permanently equal to `svh` on this page anyway.
        wrapperClassName="!p-0 flex min-h-0 flex-col overflow-hidden"
        // Door knocking is drawn edge to edge. In the design it is a modal over
        // the outreach hub — no nav rail, no page title over the map — and it
        // is reached from that hub's tile and returns there from every exit, so
        // the sidebar it would offer leads back where its own close button
        // already goes. Dropping the menu here rather than rendering outside
        // `DashboardLayout` keeps the providers this tree sits in
        // (`EcanvasserProvider`, `SidebarProvider`, the impersonation banner)
        // and costs the map only the chrome the design doesn't draw.
        hideMenu
        // The same argument one surface further down, and a worse consequence.
        // The walk owns the bottom of the window: `PersonSheet` ends in the
        // knock-log footer — `RecordKnockForm`'s "Did they answer?" ladder and
        // `NotAVoterControl` — and the campaign-manager dock's fixed bar sits
        // across exactly that strip, so a canvasser standing at the door with
        // the answer in hand has nothing on screen to write it down with.
        // Restacking is not the fix: the sheet is `fixed z-40` inside
        // `WalkSurface`'s `absolute z-20`, so it is ranked within that context
        // and can never outrank a bar in the root one.
        //
        // Its own prop rather than a second meaning for `hideMenu`, which four
        // other routes pass and none of which has a bottom of its own to
        // defend. Nothing here is taken away from the surfaces the manager is
        // reachable from — this is the one page whose job it breaks.
        hideChatDock
      >
        <div className="flex h-full w-full flex-col">
          {/* No VISIBLE page header. The design draws door knocking as a bare
            map with the current surface floating over it, and every title this
            row used to carry is already on that surface: the create flow names
            its own step, and the walk names its list on its sheet at the `peek`
            snap. The walk's compact PDF link went with it, and nothing was
            lost: `WalkView` already renders the design's own full-width `Export
            this list to PDF` above the stop list, from the same
            `ExportWalkSheetButton` — so the canvasser who walks out of signal
            still has paper, from the surface they are actually on.

            The name stays, `sr-only`: dropping the header dropped this route's
            only `h1`, and a bare WebGL canvas announces nothing, so a screen
            reader landing here had no way to know which page it was on or to
            find it by heading. Same answer `OutreachFlowShell` already gives
            for a design with no visible title — an accessible name that costs
            no pixels. */}
          <h1 className="sr-only">Door knocking</h1>
          {/* One arrangement for both modes: a full-bleed map with
            whatever surface is current floating over it. The walk used to split
            this column — a 40% map band above a scrolling list — which is the
            one layout the design does not have, and which meant the street
            being walked got the smaller half of the screen at the moment it
            mattered most. */}
          <div className="relative flex min-h-0 flex-1">
            <div className="relative min-w-0 flex-1">
              {/* Before the isPending branch: a district-gated query is neither
                pending-with-a-request nor errored, so that branch would
                otherwise spin forever. */}
              {isUnresolvable && (
                <p className="p-4 text-sm text-muted-foreground">
                  {districtUnavailableMessage(serveMode)}
                </p>
              )}
              {/* Titled, because an untitled "Loading... Something awesome."
                over a wait that runs to half a minute is the part of this that
                got reported. The create flow says the same two sentences from
                inside its own sheet — see `CreateListFlow` — since the sheet
                covers this region for the whole of the wait that matters. */}
              {!isUnresolvable && packQuery.isPending && (
                <div className="flex h-full items-center justify-center">
                  <LoadingAnimation
                    title={
                      <>
                        {packLoadingTitle(serveMode)}
                        <span className="mt-2 block text-base font-normal text-zinc-600">
                          {PACK_LOADING_DURATION}
                        </span>
                      </>
                    }
                  />
                </div>
              )}
              {packQuery.isError && (
                <p className="p-4 text-sm text-destructive">
                  {packErrorMessage(serveMode)}
                </p>
              )}
              {packQuery.data && filterResult && (
                <VoterMapCanvas
                  pack={packQuery.data}
                  filterResult={filterResult}
                  turfs={visibleTurfs}
                  routePins={walkMap.routePins}
                  // The other half of the walk's one selection: the list marks
                  // the row, the canvas rings the pin, and both read this.
                  selectedStopId={walkMap.selectedStopId}
                  routeLoop={walkMap.routeLoop}
                  routeGeometry={walkMap.routeGeometry}
                  // Nothing frames the camera at a saved turf any more: the
                  // rail that used to select one is gone, and the walk frames
                  // its own route.
                  focusTurf={null}
                  // Street level, where neighborhood street names first appear:
                  // fitBounds to the whole district opens too far out to orient
                  // against, and the map's job at mount is to say where you are.
                  // Only the opening view — panning and turf focus own it after.
                  initialZoom={16}
                  startDrawToken={draw.startDrawToken}
                  clearDrawToken={draw.clearDrawToken}
                  undoDrawToken={draw.undoDrawToken}
                  // The colour a new list is drawn in, on the boundary being cut
                  // — state the map reads, so it lives up here.
                  drawColor={draw.drawColor}
                  frameDrawToken={draw.frameDrawToken}
                  frameDrawBottomPct={draw.frameDrawBottomPct}
                  // Every step of the create flow covers the map except the
                  // drawing surface, and the draw step's preview window is a
                  // picture with a shield over it — so outside that one state
                  // the cluster would be buttons nobody can reach. Off the flow
                  // it is the walk's sheet that decides, since at its full snap
                  // it leaves nothing to zoom.
                  controlsHidden={
                    Boolean(flowStep)
                      ? !draw.fullScreen
                      : mapControlsOffset === null
                  }
                  // The drawing surface's own footer is 88px of opaque bar
                  // across the bottom, so the cluster clears it by the design's
                  // 96 rather than sitting at the 16px edge underneath it —
                  // which is what left the zoom buttons half-covered and the
                  // locate toggle entirely hidden.
                  controlsBottomPx={
                    draw.fullScreen
                      ? DRAW_CONTROLS_BOTTOM_PX
                      : (mapControlsOffset ?? 16)
                  }
                  location={location}
                  // The cluster's third button. The design's draw surface
                  // carries the full cluster — plus, minus, locate — because a
                  // boundary is cut standing on the street it covers as often
                  // as at a desk, and knowing where you are is how you know
                  // which blocks to enclose. Withheld on the flow's other
                  // steps, where the map is a shielded picture.
                  liveLocationEnabled={locationEnabled}
                  onToggleLiveLocation={
                    flowStep && !draw.fullScreen
                      ? undefined
                      : setLocationEnabled
                  }
                  // Who says so when the watch cannot produce a fix. The walk
                  // has `WalkView`'s line for it; the drawing surface has
                  // nothing, so the canvas speaks for itself there — otherwise
                  // a refused OS permission is indistinguishable from a working
                  // switch, which is exactly how it was reported.
                  locationNotice={Boolean(flowStep)}
                  onPolygonChange={setRing}
                  onDrawPointCount={draw.onPointCount}
                  onRoutePinClick={walkMap.onPinTap}
                />
              )}
              <WalkMapHint visible={walkMap.hintVisible} />
            </div>
            {/* Above every surface, including the map: this is the frame after
              the walk or the flow has been torn down and before the hub has
              arrived, and the whole point is that the map underneath is not
              what gets shown in it. */}
            {leaving && (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-background">
                <LoadingAnimation title="Taking you back…" />
              </div>
            )}
            {walkSurface()}
            {flowStep && (
              <CreateListSurface
                step={flowStep}
                filters={filters}
                onFiltersChange={setFilters}
                onStepChange={changeFlowStep}
                onClose={closeFlow}
                districtHouseholds={filterResult?.households ?? 0}
                // The count above is derived from the pack, so it reads 0 for
                // the whole of a download the sheet is drawn over. These two
                // are what let the flow say so instead of printing that 0 as
                // an answer.
                // Same `!isUnresolvable` guard the map region carries: a
                // district-gated query never leaves pending, so without it the
                // sheet promises a download that was never requested, over a
                // Continue that will never enable.
                districtHouseholdsPending={
                  !isUnresolvable && packQuery.isPending
                }
                districtHouseholdsFailed={packQuery.isError}
                districtUnavailable={isUnresolvable}
                ring={ring}
                turfStats={turfStats}
                drawPointCount={draw.pointCount}
                onUndoPoint={draw.undoPoint}
                drawFullScreen={draw.fullScreen}
                onDrawFullScreenChange={draw.setFullScreen}
                onRestartDrawing={draw.startDrawing}
                color={draw.drawColor}
                drawnStops={drawnStops}
                onListCreated={handleListCreated}
                isServeOrg={isServeOrg}
                unpreviewableKeys={unpreviewableKeys}
                orgSlug={organization?.slug}
                preselectedListId={carriedListId}
                onPreselectApplied={() =>
                  setSpentPreselectId(preselectedListId)
                }
              />
            )}
          </div>
        </div>
        {detailsTurf && (
          <TurfDetailsSheet
            turf={detailsTurf}
            isServeOrg={isServeOrg}
            onClose={() => setDetailsTurf(null)}
            // Start knocking closes the drawer to uncover the walk, and closing
            // the walk brings it back: the candidate was reading this list's
            // details and went to knock it, so the details are where they left
            // off. The turf is captured rather than re-resolved because the row
            // it names can be completed BY that walk.
            onKnock={(turf) => {
              setDetailsTurf(null)
              startKnocking(turf, { kind: 'details', turf })
            }}
          />
        )}
        {/* One action and no cancel: there is nothing to decide here, and
            nothing the candidate can do to proceed today. The remedy the copy
            names — go knock what is already mapped — is behind this dialog on
            the rail it opened over. */}
        <AlertDialog
          open={refusedCampaignLimit !== null}
          onOpenChange={(next) => {
            if (!next) setRefusedCampaignLimit(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Daily limit reached</AlertDialogTitle>
              <AlertDialogDescription>
                You&apos;ve created {refusedCampaignLimit} door knocking
                campaigns today. Go knock the doors you&apos;ve already mapped,
                and build more lists tomorrow.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onClick={() => setRefusedCampaignLimit(null)}>
                Got it
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DashboardLayout>
    </DoorKnockingSurface>
  )
}

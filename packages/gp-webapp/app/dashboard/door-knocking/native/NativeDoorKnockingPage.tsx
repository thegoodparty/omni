'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DOOR_KNOCK_STATUSES,
  DoorKnockingTurf,
  type RecommendedListVariant,
} from '@goodparty_org/contracts'
import { Spinner } from '@styleguide'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { Campaign } from 'helpers/types'
import type { VoterFileFilters } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import {
  districtUnavailableMessage,
  packErrorMessage,
  recordLoggedKnocks,
  voterPackQueryOptions,
} from './useVoterPack'
import {
  applyLoggedKnocks,
  polygonStats,
  runFilter,
  type DimSelections,
  type FilterResult,
  type PolygonStats,
} from './filterEngine'
import type { DecodedPack } from './packDecoder'
import { campaignTurfsQueryOptions, turfsQueryOptions } from './turfQueries'
import { assignNextColor } from './turfColors'
import {
  draftAsTurfLike,
  draftTurfId,
  isDrawnTurf,
  patchChangesDraft,
  sameDrafts,
  type TurfDraft,
} from './turfDrafts'
import { StartKnockingDialog } from './StartKnockingDialog'
import { DoorKnockingSurface } from './doorKnockingSurface'
import {
  HARD_STOP_LIMIT,
  type CreateFlowStep,
} from './createFlow/CreateListFlow'
import {
  filtersToDimSelections,
  unpreviewableFilterKeys,
} from './createFlow/voterFilterPreview'
import CreateListSurface, { useCreateListDraw } from './CreateListSurface'
import { TurfPanel } from './createFlow/TurfPanel'
import { useTeamOptions } from './useTeamOptions'
import { useDrawExpand } from './useDrawExpand'
import TurfDetailsSheet from './TurfDetailsSheet'
import WalkSurface, { useWalkMapSession, WalkMapHint } from './WalkSurface'
import { useWalkSession } from './useWalkSession'
import { useLiveLocation } from './useLiveLocation'
import {
  useWalkArchive,
  useWalkCompletion,
  useWalkMarkDone,
} from './walkCompletion'
import { canCompleteTurf } from './turfLifecycle'
import { packBounds, type PolygonRing } from './VoterMapCanvas'
import { geoapifyStaticUrl } from './createFlow/geoapifyStaticUrl'
import { useDistrictResolution } from 'app/dashboard/shared/useDistrictResolution'
import { usePrecinctOptions } from 'app/dashboard/contacts/crm/wizard/usePrecinctOptions'
import { useOrganization } from '@shared/organization-picker'

// One loading vocabulary for both waits that show behind the walk drawer:
// the pack download (4.5s p50 / 34s p95) AND the VoterMapCanvas chunk
// (~200ms first time, cached after). Spinner + "Loading your route" body
// text side-by-side. `bottomPadPx` shifts vertical centering above the
// walk drawer so the loader lands in the visible band, not the viewport
// middle (which the drawer covers) — dynamic-import fallback below calls
// it with no arg since it can't reach the page's mapControlsOffset state,
// which is fine because the chunk load is brief and cached after first.
//
// `absolute inset-0` so the loader OVERLAYS the map region instead of
// stacking beside a rendered canvas. When the pack is warm from the
// create flow and only the walk's route is still fetching, both this
// loader and VoterMapCanvas satisfy their render gates at once — in a
// non-flex parent that means two `h-full` siblings pushing each other
// out of view.
//
// Background hardcoded to `#f8f4f0` — Geoapify OSM Liberty's land
// color, the warm off-white the map itself paints under everything
// else. Matching it means the loader hides the bare district beneath
// the canvas WITHOUT a visible seam when it clears (both sides of the
// transition are the same shade). No design token for this because
// it's a vendor-basemap match, not a design-system color.
const MapLoader = ({ bottomPadPx }: { bottomPadPx?: number | null } = {}) => (
  <div
    className="absolute inset-0 z-10 flex items-center justify-center gap-3 bg-[#f8f4f0]"
    style={bottomPadPx ? { paddingBottom: bottomPadPx } : undefined}
  >
    <Spinner />
    <p className="text-base text-foreground">Loading your route</p>
  </div>
)

const VoterMapCanvas = dynamic(() => import('./VoterMapCanvas'), {
  ssr: false,
  loading: () => <MapLoader />,
})

interface NativeDoorKnockingPageProps {
  pathname: string
  campaign: Campaign | null
  // A saved list carried in on `?listId=`, handed straight to the create
  // flow. Deliberately NOT read by anything on the landing map: it names the
  // audience a walk will be cut from, and the map's own scope is the rail's
  // `selectedTurf`, which is a turf and not a list.
  preselectedListId?: number
  // A recommendation carried in on `?recommended=` (a voter data page card
  // not saved yet), handed to the create flow the same way and spent the
  // same way.
  preselectedRecommendedVariant?: RecommendedListVariant
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
  // `?campaignOutreachId=` — the campaign drawer's "Add another turf" opens
  // the create flow onto an existing campaign. Threaded down to the surface
  // and used to fetch the sibling turfs whose colors seed the picker's
  // default and whose count decides the "Turf N" name default.
  campaignOutreachId?: number
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

// The orchestrator for the two door-knocking surfaces. What stays here is what
// the MAP reads, plus the handoffs between surfaces: each surface declares its
// own contract in its own file, and none of them reaches into this one. The two
// seams are `CreateListSurface` and `WalkSurface` — see the section in this
// directory's AGENTS.md before changing any of their props.
export default function NativeDoorKnockingPage({
  pathname,
  campaign,
  preselectedListId,
  preselectedRecommendedVariant,
  walkTurfId,
  fromOutreachId,
  openCreateFlow,
  campaignOutreachId,
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
  // The district's precinct vocabulary, for the who step's precinct group.
  // Gated on the flow being open so a door-knocking page view that never
  // reaches the audience step buys nothing, and on a resolvable district for
  // the same reason every other read on this page is.
  const precinctOptions = usePrecinctOptions(
    flowStep !== null && !isUnresolvable,
  )
  // Which carried list has already been handed to the create flow. Kept here
  // because the flow itself is unmounted between opens while `?listId=` stays
  // in the address bar, so this is the only place that can remember. Compared
  // by id rather than a boolean so a SECOND arrival still counts: coming back
  // to the hub and pressing the tile again with a different list re-renders
  // this page with the new id, which is not the spent one.
  const [spentPreselectId, setSpentPreselectId] = useState<number>()
  const carriedListId =
    preselectedListId === spentPreselectId ? undefined : preselectedListId
  const [spentPreselectVariant, setSpentPreselectVariant] =
    useState<RecommendedListVariant>()
  const carriedVariant =
    preselectedRecommendedVariant === spentPreselectVariant
      ? undefined
      : preselectedRecommendedVariant
  const [filters, setFilters] = useState<VoterFileFilters>({})
  // The hand-cut precinct selection, beside `filters` because precinct values
  // are enumerated per district and the boolean draft has no key for them —
  // it carries only the `precincts` mark, which is what
  // `unpreviewableFilterKeys` below reads to disclose that the map cannot
  // shade by them.
  const [precincts, setPrecincts] = useState<string[]>([])
  const [ring, setRing] = useState<PolygonRing | null>(null)
  // The multi-turf drafts committed in the drawing surface this session,
  // BEFORE the paid press on the route step. Lives here (not in the flow)
  // because the CANVAS renders them: each draft is a polygon the canvas
  // draws next to any siblings the campaign already holds. The flow reads
  // this to render draft cards on the draw step body and to batch-POST them
  // on save. Empty on a fresh campaign, populated as the candidate presses
  // "+ Add turf" / "Save turf(s)" on the drawing surface.
  const [turfDrafts, setTurfDrafts] = useState<TurfDraft[]>([])
  // Which committed draft the canvas is currently holding open for edits, or
  // null when the ring being drawn is a brand-new turf nobody has committed.
  //
  // Up here with the drafts because the CANVAS reads it: the turf being
  // edited is drawn by the drawing session rather than by `saved-turfs`, so
  // `visibleTurfs` below has to leave it out or the same boundary renders
  // twice — once frozen at the shape it had when it was committed, once live
  // under the candidate's cursor. During a vertex drag those two disagree,
  // and the frozen one reads as a ghost of the shape being moved.
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)
  // The same answer as `activeDraftId`, readable synchronously.
  //
  // It has to be a ref as well as state, and the reason is the order the
  // canvas reports in. Switching from Turf A to Turf B sets the active turf
  // and asks the canvas to load B's ring; the canvas answers on its own
  // schedule, after paint. In the window between the two, `ring` still holds
  // A's boundary — so anything that decided where to write that boundary by
  // reading state would write A's shape onto B. The ref is moved at the
  // switch, before the load is asked for, so the answer is already B by the
  // time B's ring arrives.
  const activeDraftRef = useRef<string | null>(null)
  // Actions the drawing surface and the draw-step body call to grow, edit
  // or drop drafts. Wrapped in useCallback so the flow's own memoized
  // derivations do not churn on every render — the drafts array itself is
  // what changes.
  // Returns the id it minted, so the caller can make the new draft the active
  // one in the same tick. The id is generated here rather than inside the
  // updater because an updater runs twice under StrictMode, and a caller that
  // read its result from a second invocation would be holding an id no draft
  // in the list carries.
  const commitDraft = useCallback((draft: Omit<TurfDraft, 'clientId'>) => {
    const clientId = `draft-${crypto.randomUUID()}`
    setTurfDrafts((current) => [...current, { ...draft, clientId }])
    return clientId
  }, [])
  const updateDraft = useCallback(
    (clientId: string, patch: Partial<Omit<TurfDraft, 'clientId'>>) => {
      setTurfDrafts((current) => {
        const draft = current.find((entry) => entry.clientId === clientId)
        // A write that changes nothing returns the list untouched, rather
        // than mapping a new array over identical contents. Re-entering the
        // drawing surface re-reports the boundary already under the cursor,
        // and that report used to replace the array — which made the session
        // dirty before the candidate had done anything, and cost the stats
        // cache (keyed on polygon identity) a full re-scan of the pack.
        if (!draft || !patchChangesDraft(draft, patch)) return current
        return current.map((entry) =>
          entry.clientId === clientId ? { ...entry, ...patch } : entry,
        )
      })
    },
    [],
  )
  const clearDrafts = useCallback(() => {
    setTurfDrafts([])
    activeDraftRef.current = null
    setActiveDraftId(null)
  }, [])
  // The turfs as they stood when the drawing surface last opened, so Cancel
  // can put them back.
  //
  // A turf becomes a draft the moment its third corner lands, which is what
  // gives the panel a colour and a canvasser to hang off it — so by the time
  // Save is pressed the turfs are already in state and Save has nothing left
  // to do. The snapshot is what makes both words on that footer true: Save
  // keeps what is here, Cancel restores what was.
  //
  // It restores to the SESSION's start and not to empty. Re-entering through
  // "Draw more turfs" and changing your mind must not delete the turfs cut
  // before this session began.
  const sessionSnapshot = useRef<TurfDraft[] | null>(null)
  // "Add another turf" arrives with `?campaignOutreachId=`. Two things
  // read the resolved sibling list: the create flow (default name + colour
  // picker default), and `useCreateListDraw` below (seed colour). Only
  // fires when the caller says so — a solo create never asks — and the
  // response is empty during the fetch, which is what makes the seed and
  // name defaults land as though it were a solo campaign until the answer
  // arrives.
  const campaignSiblingsQuery = useQuery({
    ...campaignTurfsQueryOptions(campaignOutreachId ?? 0),
    enabled: campaignOutreachId !== undefined,
  })
  // `undefined` covers three cases the flow's naming default reads as one:
  // "not joining a campaign", "joining but the fetch is still pending", and
  // "joining but the fetch failed". Collapsing pending into `[]` would let
  // the confirm step suggest `Turf 1` on a campaign that already has three
  // — the user has no signal that the answer is late — so this only reports
  // the real siblings once the query has actually returned them. The seed
  // colour follows the same rule below: if we don't know, don't pretend.
  const siblingTurfs =
    campaignOutreachId !== undefined && campaignSiblingsQuery.isSuccess
      ? campaignSiblingsQuery.data
      : undefined
  // The palette-next slot for the drawn ring. `undefined` on a solo create
  // resolves to the assigner's default (`TURF_COLORS[0]`), so a candidate
  // opening the flow with no siblings still lands on blue.
  // Every colour already spoken for in this campaign, so the next turf lands
  // on the next free slot. The drafts count as much as the bought siblings do
  // — they are drawn on the same map at the same time, and a campaign whose
  // second and third turfs came out the same blue is exactly what the palette
  // exists to prevent.
  const seedColor = useMemo(
    () =>
      assignNextColor([
        ...(siblingTurfs ?? []).map((turf) => turf.color),
        ...turfDrafts.map((draft) => draft.color),
      ]),
    [siblingTurfs, turfDrafts],
  )
  // The create-list surface's half of the canvas: draw tokens, the point count
  // and the coach mark. Called here because the canvas outlives the flow.
  const draw = useCreateListDraw(seedColor)
  // How many turfs this campaign will hold once the one being drawn is
  // counted — the numbering the toolbar's "Turf N" reads.
  const campaignTurfCount = (siblingTurfs?.length ?? 0) + turfDrafts.length
  // What the in-progress ring is drawn in, and the one answer the toolbar's
  // swatch and the canvas both read.
  //
  // A committed turf owns its colour; only a turf that does not exist yet
  // takes the palette's next free slot. Reading `draw.drawColor` directly
  // here was wrong in a way the flow makes immediate: committing a draft
  // adds its colour to the campaign, which moves the seed on, which
  // repainted the very ring that had just been committed — so the shape on
  // screen went green while its draft stayed blue, and the card on the step
  // behind disagreed with the map.
  const activeDraft =
    turfDrafts.find((draft) => draft.clientId === activeDraftId) ?? null
  const ringColor = activeDraft?.color ?? draw.drawColor
  // Shares a cache key with the draw step's own read, so the panel's assignee
  // control and the step's cards cost one request between them.
  const teamOptions = useTeamOptions(organization?.slug)
  // The map opening out of the rectangle that was pressed, and folding back
  // into it. See `useDrawExpand` for why it is a clip and not a transform.
  const drawExpand = useDrawExpand()
  const openDrawing = useCallback(
    (full: boolean, origin?: DOMRect) => {
      if (!full) {
        draw.setFullScreen(false)
        return
      }
      sessionSnapshot.current = turfDrafts
      draw.setFullScreen(true)
      if (origin) drawExpand.expand(origin)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [turfDrafts, draw.setFullScreen, drawExpand.expand],
  )
  // Leaving the surface, either way. The fold runs BEFORE the flow's sheet
  // comes back, because the sheet's destination is the card the map is
  // folding into — put it back first and it covers the whole animation.
  const closeDrawing = useCallback(
    (after?: () => void) => {
      drawExpand.collapse(() => {
        draw.setFullScreen(false)
        after?.()
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draw.setFullScreen, drawExpand.collapse],
  )
  const cancelDrawing = useCallback(() => {
    const restored = sessionSnapshot.current ?? []
    setTurfDrafts(restored)
    // The active turf may be one this cancel just removed, and a ref left
    // pointing at a draft that no longer exists is what makes the next valid
    // ring write its shape onto nothing.
    const stillThere = restored.some(
      (draft) => draft.clientId === activeDraftRef.current,
    )
    if (!stillThere) {
      activeDraftRef.current = null
      setActiveDraftId(null)
      setRing(null)
    }
    closeDrawing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeDrawing])
  // Whether this drawing session has changed anything — by VALUE, not by
  // array identity. Reference equality was the original test, on the argument
  // that every writer replaces the array; what broke it is that reopening the
  // surface re-reports the boundary already under the cursor, so a writer
  // started replacing the array with identical contents and Cancel asked what
  // to discard about a session nobody had touched. `updateDraft` no longer
  // does that, and this no longer depends on it not doing it.
  const sessionDirty =
    sessionSnapshot.current !== null &&
    !sameDrafts(sessionSnapshot.current, turfDrafts)

  // The canvas reporting the boundary under the cursor, and the one place a
  // draft's geometry is ever written.
  //
  // A turf becomes a draft the moment its ring is valid, rather than at some
  // later "commit" press. That is what gives the toolbar something real to
  // hang a colour, a name and an assignee off: a candidate who draws three
  // corners and then picks an assignee is talking about a turf, and a turf
  // that only exists as loose page state until they press something else has
  // nowhere to put the answer.
  // What a NEW draft is stamped with, read at the moment one is committed
  // rather than closed over. Both change as turfs are cut — a new draft moves
  // the palette on and the numbering up — and the handler below has to stay
  // one object for the life of the mount: the canvas keeps it in a ref, so a
  // fresh identity buys nothing, and anything that keys an effect on it
  // instead re-runs on every turf.
  // Where the cursor goes when whatever it was on is gone — a turf deleted,
  // or a half-cut one thrown away. The turf cut most RECENTLY takes it, so
  // the panel closes back onto the list it already has.
  //
  // Handing the canvas a fresh empty session instead is what put a blank
  // card on the panel after every delete: the turf being cut has a card of
  // its own, so opening a session ADDED one at the moment a turf was
  // removed. With nothing left to fall back to there is no card either —
  // the panel returns to its empty state and the session waits behind it.
  //
  // The boundary has to be let go of in both branches. Letting go of the
  // draft alone left the removed turf's ring painted on the map with
  // nothing in the panel that owned it: the shape was still there, the
  // card underneath it named a turf with no boundary, and the two were
  // describing different worlds. `visibleTurfs` handles a turf that was
  // not the one being cut — it reads `turfDrafts`, so that ring goes with
  // the draft. Only the live drawing session has a second copy to clear.
  const handBackCursor = useCallback(
    (remaining: TurfDraft[]) => {
      setRing(null)
      setPendingAssigneeId(null)
      setPendingName('')
      const last = remaining[remaining.length - 1]
      if (last) {
        activeDraftRef.current = last.clientId
        setActiveDraftId(last.clientId)
        draw.loadRing(last.polygon, last.color)
        return
      }
      activeDraftRef.current = null
      setActiveDraftId(null)
      // The freed colour goes back into the palette rather than the session
      // advancing past it, which `startNextTurf` deliberately does:
      // removing the only turf and drawing again should give back the blue
      // Turf 1 was cut in, not the next hue along. `seedColor` cannot
      // answer yet — it is a memo over state the caller has only just
      // queued — so the same expression is evaluated here against the list
      // that is left.
      draw.startNewTurf(
        assignNextColor([
          ...(siblingTurfs ?? []).map((turf) => turf.color),
          ...remaining.map((draft) => draft.color),
        ]),
      )
    },
    [draw, siblingTurfs],
  )
  const removeDraft = useCallback(
    (clientId: string) => {
      const remaining = turfDrafts.filter(
        (draft) => draft.clientId !== clientId,
      )
      // The WRITE is a functional updater and the snapshot above is only
      // for the cursor. A partial create drops its saved drafts in a loop —
      // `for (const row of created) onRemoveDraft(...)` — and every call in
      // that loop reads the same render's `turfDrafts`, so writing the
      // snapshot back would keep only the last removal and hand the retry a
      // turf it had already bought.
      setTurfDrafts((current) =>
        current.filter((draft) => draft.clientId !== clientId),
      )
      // Dropping the turf that is open for edits leaves the drawing session
      // holding a boundary with nothing behind it. Letting go of it here is
      // what makes the next valid ring commit a fresh draft instead of
      // writing its shape onto a draft that no longer exists.
      if (activeDraftRef.current !== clientId) return
      handBackCursor(remaining)
    },
    [handBackCursor, turfDrafts],
  )
  // Who the turf being cut will be handed to, before there is a turf to hand
  // it to. The panel's card is open from the first corner, so the canvasser
  // can be picked then; it is stamped onto the draft when one is committed,
  // and `startNextTurf` clears it — a fresh turf inherits the palette's next
  // colour, never the last turf's volunteer.
  const [pendingAssigneeId, setPendingAssigneeId] = useState<number | null>(
    null,
  )
  // What the next turf will be called, typed before a single corner is
  // down. The card for the turf being cut is open from the moment the
  // surface is, so naming is the first thing that can be done rather than
  // something to remember afterwards — and it is stamped onto the draft the
  // instant one commits, so the name is never attached to a shape the
  // candidate has stopped thinking about.
  const [pendingName, setPendingName] = useState('')
  const newDraftDefaults = useRef({
    color: draw.drawColor,
    count: 0,
    assigneeId: null as number | null,
    name: '',
  })
  newDraftDefaults.current = {
    color: draw.drawColor,
    count: campaignTurfCount,
    assigneeId: pendingAssigneeId,
    name: pendingName,
  }
  const handlePolygonChange = useCallback(
    (next: PolygonRing | null) => {
      setRing(next)
      const active = activeDraftRef.current
      if (!next) {
        // Undone back below three corners. The turf keeps its identity,
        // its colour and its canvasser — deleting it here would lose all
        // three to a press of Undo — but it no longer has a boundary, and
        // everything that reports one has to stop: its card said "43
        // stops" about a shape that was no longer on the map.
        //
        // A brand-new turf that has not reached three corners yet has no
        // draft at all, so there is nothing to blank.
        if (active !== null) updateDraft(active, { polygon: [] })
        return
      }
      if (active !== null) {
        updateDraft(active, { polygon: next })
        return
      }
      const { color, assigneeId, name } = newDraftDefaults.current
      const clientId = commitDraft({
        polygon: next,
        color,
        // Whatever was typed into the open card before the first corner
        // landed, which is where the flow now asks for it. Empty if they
        // skipped it — the card goes on inviting a name, and Save is what
        // refuses to leave without one.
        name,
        assigneeId,
      })
      activeDraftRef.current = clientId
      setActiveDraftId(clientId)
      setPendingAssigneeId(null)
      setPendingName('')
    },
    [commitDraft, updateDraft],
  )
  // Keeping the turf being cut when the cursor leaves it. It has no draft
  // behind it — that is what "being cut" means — so without this, moving
  // away throws out the name typed into its open card, the canvasser
  // picked for it, and the card itself. It is committed SHAPELESS: the
  // corners already placed do go, because a ring below three points is not
  // a boundary and there is nowhere to keep two of them, but the turf they
  // started survives as a card that says what it is short of.
  //
  // No-op once a third corner has landed, since from then on there is a
  // draft and everything is already written to it.
  const parkTurfBeingCut = useCallback(() => {
    if (activeDraftRef.current !== null) return false
    commitDraft({
      polygon: [],
      color: draw.drawColor,
      name: pendingName,
      assigneeId: pendingAssigneeId,
    })
    return true
  }, [commitDraft, draw, pendingAssigneeId, pendingName])
  // Starting the next turf: let go of the active one and hand the canvas an
  // empty session. The turf just finished keeps its draft — this is "I'm done
  // with that one", not "throw it away".
  //
  // The turf being cut is parked on the way past, empty or not: the press
  // is a request FOR a card, and answering it by leaving the panel exactly
  // as it was is what made the button look broken.
  const startNextTurf = useCallback(() => {
    const parkedColor = draw.drawColor
    const parking = parkTurfBeingCut()
    activeDraftRef.current = null
    setActiveDraftId(null)
    setPendingAssigneeId(null)
    setPendingName('')
    setRing(null)
    // `seedColor` is a memo over drafts this call has only just added to,
    // so the parked turf's own colour has to be excluded by hand or the
    // next turf is cut in the hue just used.
    draw.startNewTurf(
      parking
        ? assignNextColor([
            ...(siblingTurfs ?? []).map((turf) => turf.color),
            ...turfDrafts.map((draft) => draft.color),
            parkedColor,
          ])
        : seedColor,
    )
  }, [draw, parkTurfBeingCut, seedColor, siblingTurfs, turfDrafts])
  // Picking an existing turf out of the toolbar: its boundary goes back under
  // the cursor in its own colour. The ref moves first — see its declaration
  // for why the order is load-bearing.
  const selectDraft = useCallback(
    (clientId: string) => {
      const draft = turfDrafts.find((entry) => entry.clientId === clientId)
      if (!draft) return
      // Reported from the app twice: name the turf you are cutting, click
      // another turf, and the one you named is gone — then again for one
      // with nothing typed into it yet. Its card only exists while it is
      // the one under the cursor, so moving the cursor took it off the
      // panel. Parked unconditionally, empty or not: a card on this panel
      // is a turf the candidate started, and the only thing that takes one
      // off is delete.
      parkTurfBeingCut()
      setPendingAssigneeId(null)
      setPendingName('')
      activeDraftRef.current = clientId
      setActiveDraftId(clientId)
      draw.loadRing(draft.polygon, draft.color)
    },
    [draw, parkTurfBeingCut, turfDrafts],
  )
  // Throwing away the turf being cut, from its own card. There is no draft
  // to remove — that is what "being cut" means — so what goes is the
  // drawing session: the corners placed so far, the name typed into the
  // open card, and the canvasser picked for it. Every draft survives,
  // which is why this hands back the list unchanged.
  const discardPendingTurf = useCallback(
    () => handBackCursor(turfDrafts),
    [handBackCursor, turfDrafts],
  )
  // The toolbar's colour picker. Both halves are needed and neither is
  // redundant: the canvas tints the live ring from `drawColor`, and the draft
  // is what the ring will be saved as, so a hue written to only one of them
  // survives exactly until the candidate switches turfs.
  const pickActiveColor = useCallback(
    (color: string) => {
      draw.pickColor(color)
      const active = activeDraftRef.current
      if (active !== null) updateDraft(active, { color })
    },
    [draw, updateDraft],
  )
  // Renaming the turf under the cursor, from its open card. Same shape as
  // the colour above, with one addition: before a third corner lands there
  // is no draft to write to, so the name is held as `pendingName` and
  // stamped on at commit. That is what lets a turf be named BEFORE it is
  // drawn, which is the order the card invites — it is open and asking from
  // the moment the surface is.
  const renameActiveTurf = useCallback(
    (name: string) => {
      const active = activeDraftRef.current
      if (active === null) {
        setPendingName(name)
        return
      }
      updateDraft(active, { name })
    },
    [updateDraft],
  )
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
  // The walk's manual Done. Same ref-held turf as the two above; the button
  // is withheld rather than disabled on a list already done or archived,
  // because the row itself is the authority and it refetches after the write.
  const walkMarkDone = useWalkMarkDone(walkTurfRow)
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

  // During a walk, scope the map to just this turf's ring — the neighbors'
  // rings are noise around the route the canvasser is on. The whole saved
  // list stays on screen everywhere else (the hub view, the create flow's
  // preview map behind its own sheet), so the filter is walk-scoped and not
  // a global toggle.
  //
  // Saved turfs render on this map only during a walk, and only the one
  // being walked. Every other state — the create flow (all of it), the
  // brief transition into a walk when handleListCreated batches
  // flow-close + walk-start, and any window where neither is on screen —
  // shows a bare map without other rings.
  //
  // The design has no landing surface that lists saved turfs on a bare
  // map, so nothing depends on "show all rings when idle" being real. The
  // create flow used to show them scoped by the draw preview; the draw
  // surface then took the whole map for a single-task cut. Both cases
  // want zero saved rings visible. During a walk, the neighbours' rings
  // are noise around the route the canvasser is on, so we scope to just
  // the walked turf. Everything else falls into "hide them" by default,
  // which is what removes the flash on the sheet-close/walk-open handoff
  // (there's no window where saved rings can render before the walk
  // scoping kicks in — they're just always hidden unless a walk is up).
  const visibleTurfs = useMemo(() => {
    if (walkTurf) {
      const all = turfsQuery.data ?? []
      return all.filter((candidate) => candidate.id === walkTurf.id)
    }
    // In the create flow: show the campaign's existing siblings (only
    // populated when arriving via "Add another turf") plus every draft the
    // candidate has committed on the drawing surface this session. Drafts
    // are shape-adapted to DoorKnockingTurf so the canvas's saved-turfs
    // layer renders them with their colour, no new layer required. When
    // neither is present (a fresh campaign, no draws yet), the array is
    // empty and the map draws clean.
    // The turf currently open for edits is left out: the drawing session is
    // already drawing it, live, with its corners grabbable. Drawn here too it
    // would appear twice — and during a vertex drag the frozen copy holds the
    // shape the ring had before the drag, which reads as a ghost trailing the
    // boundary being moved.
    const siblings = siblingTurfs ?? []
    const drafts = turfDrafts
      .filter((draft) => draft.clientId !== activeDraftId)
      // A boundary-less turf has no ring to draw. Only the active turf can
      // be in that state today, and it is already excluded above — this is
      // the guard that keeps `draftAsTurfLike` from ever being handed a
      // polygon the layer cannot render.
      .filter(isDrawnTurf)
      .map(draftAsTurfLike)
    return [...siblings, ...drafts]
  }, [turfsQuery.data, walkTurf, siblingTurfs, turfDrafts, activeDraftId])
  // The pack's bounding box, framed by the create flow's draw step as a
  // static-map preview card. Null while the pack decodes; the card omits
  // the image in that window rather than rendering against no rect.
  const districtBounds = useMemo(
    () => (packQuery.data ? packBounds(packQuery.data.positions) : null),
    [packQuery.data],
  )
  // Warm the browser cache for the draw step's Geoapify preview the
  // moment the pack lands, so the image is already fetched by the time
  // the candidate reaches step 3. Without this, the <img> tag doesn't
  // start its request until DrawStep mounts, adding a 200-500ms visible
  // flash on top of the pack wait the who step already covers. Same URL
  // shape DrawStep builds, so any near-future <img src> hits the cache.
  useEffect(() => {
    if (!districtBounds || typeof Image === 'undefined') return
    const img = new Image()
    img.src = geoapifyStaticUrl({
      bounds: districtBounds,
      width: 608,
      height: 260,
    })
  }, [districtBounds])
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
  const turfStats = useMemo(
    () =>
      packQuery.data && ring && selections
        ? polygonStats(packQuery.data, selections, ring)
        : null,
    [packQuery.data, selections, ring],
  )
  // The same three figures for every turf cut this session, so the draw
  // step's cards can say how the campaign is divided up. Cutting several
  // turfs is how one evening's work is split between people, and a card
  // that only carried a name would leave the candidate no way to see that
  // one volunteer got 200 doors and another got 40.
  //
  // Cached per draft on the identity of its polygon, which is what keeps
  // this affordable. `polygonStats` ray-casts the whole pack — up to a few
  // hundred thousand dots — and the draft being edited has its polygon
  // rewritten on every vertex the candidate drags. Without the cache each
  // of those frames would re-stat every OTHER turf too, for answers that
  // cannot have changed. `updateDraft` replaces only the draft it touches,
  // so an untouched draft keeps its polygon reference and its cache entry.
  const draftStatsCache = useRef({
    pack: null as DecodedPack | null,
    selections: null as DimSelections | null,
    entries: new Map<string, { polygon: PolygonRing; stats: PolygonStats }>(),
  })
  const draftStats = useMemo(() => {
    const pack = packQuery.data
    const stats = new Map<string, PolygonStats>()
    if (!pack || !selections) return stats
    const cache = draftStatsCache.current
    // The audience is what these counts are OF, so a walk back to the who
    // step invalidates every one of them. Cheaper to notice here than to
    // key each entry on a filter draft.
    if (cache.pack !== pack || cache.selections !== selections) {
      cache.pack = pack
      cache.selections = selections
      cache.entries.clear()
    }
    for (const draft of turfDrafts) {
      // A turf undone below three corners has no shape to measure. Skipping
      // it leaves no entry, which the card reads as "no answer" and prints
      // as "Drawing" rather than as a stale count.
      if (!isDrawnTurf(draft)) continue
      const cached = cache.entries.get(draft.clientId)
      if (cached && cached.polygon === draft.polygon) {
        stats.set(draft.clientId, cached.stats)
        continue
      }
      const next = polygonStats(pack, selections, draft.polygon)
      cache.entries.set(draft.clientId, { polygon: draft.polygon, stats: next })
      stats.set(draft.clientId, next)
    }
    return stats
  }, [packQuery.data, selections, turfDrafts])
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

  // The one door into a walk, and the one place the travel question is
  // asked. Four surfaces reach it: the rail card's Knock, the details
  // sheet's Start knocking, the create flow's success screen, and the
  // outreach drawer's Continue knocking through the deep link below. Each
  // passes where closing should return to.
  //
  // An UNROUTED turf has no walk to open yet — the doors are frozen but
  // nothing has decided what order to walk them in — so the question comes
  // first and the answer is what buys the route. A routed turf goes straight
  // through: its route is frozen and documented as never re-bought, so
  // asking again would collect an answer that changes nothing.
  const startKnocking = (turf: DoorKnockingTurf, origin: WalkOrigin) => {
    if (turf.routeSeconds === null) {
      setKnockPrompt({ turf, origin })
      return
    }
    // Only now, because only now is there somewhere to go. Tearing the flow
    // down beside the QUESTION left a candidate who cancelled it on a bare
    // map with no flow, no walk and no nav — this page hides it — which is
    // reachable straight off the success screen.
    leaveFlowForWalk()
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
    // Through `startKnocking` rather than straight to `walk.start`, so a
    // turf the outreach drawer sent us to that has never been walked gets
    // the same travel question as one pressed on the rail.
    startKnocking(
      turf,
      fromOutreachId === undefined
        ? { kind: 'hub' }
        : { kind: 'outreach', outreachId: fromOutreachId },
    )
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

  // Every way into the create flow goes through here. It used to be where the
  // daily campaign allowance refused the FLOW rather than the press at the end
  // of it; the allowance is gone, so the flow simply opens.
  const beginCreateFlow = useCallback((): boolean => {
    setFlowStep('filters')
    return true
  }, [])

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
    if (isUnresolvable) return
    landingOpened.current = true
    beginCreateFlow()
  }, [walkTurfId, deadWalkLink, walkTurf, isUnresolvable, beginCreateFlow])

  const changeFlowStep = (next: CreateFlowStep) => {
    // Arriving at the draw step from anywhere else — this is where the
    // candidate cuts turfs into the campaign they just named. The
    // transition alone cannot say whether it's a first arrival (blank
    // session needed) or a Back+Continue round trip (keep the boundary
    // already drawn), and a ring is what tells them apart. Treating the
    // round trip as a first arrival is what used to throw the shape away.
    if (next === 'draw' && flowStep !== 'draw') {
      if (ring) draw.resumeDrawing()
      else draw.startDrawing()
    }
    setFlowStep(next)
  }
  // Backing out with nothing saved. There is no map behind this worth landing
  // on — the rail is gone — so closing the flow leaves door knocking, exactly
  // as closing the walk does.
  const closeFlow = () => {
    setFlowStep(null)
    setFilters({})
    setPrecincts([])
    // Every turf cut this session goes with the flow that cut them. None of
    // them was paid for, and leaving is the candidate saying so — a draft
    // that outlived the close would reappear on the next create as a
    // boundary nobody drew for it.
    clearDrafts()
    setRing(null)
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
  // The turf whose walk-or-drive question is on screen, with where closing
  // its walk should return to. Null when nothing is being asked.
  const [knockPrompt, setKnockPrompt] = useState<{
    turf: DoorKnockingTurf
    origin: WalkOrigin
  } | null>(null)

  // Tears the create flow down so the walk can own the screen. A no-op when
  // the flow is not open, which is most of the ways into a walk.
  const leaveFlowForWalk = () => {
    setRing(null)
    tileOpened.current = false
    setFlowStep(null)
    setFilters({})
    setPrecincts([])
    clearDrafts()
    draw.clearDrawing()
  }

  // "Start knocking" on one turf of the flow's success screen. The flow is
  // on screen here and nothing else is, so it comes down first.
  const handleStartKnocking = (turf: DoorKnockingTurf) => {
    startKnocking(turf, { kind: 'hub' })
  }

  // The vendor has answered and the turf is routed, so the walk has
  // something to serve. The origin is the one the press carried in, not the
  // hub: a knock started from the outreach drawer still returns there.
  const handleRouteBuilt = (turf: DoorKnockingTurf) => {
    const origin = knockPrompt?.origin ?? { kind: 'hub' }
    setKnockPrompt(null)
    leaveFlowForWalk()
    walkOrigin.current = origin
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
        onMarkDone={
          walkTurfRow && canCompleteTurf(walkTurfRow)
            ? walkMarkDone.markDone
            : undefined
        }
        markDonePending={walkMarkDone.pending}
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
          <div
            ref={drawExpand.hostRef}
            className="relative flex min-h-0 flex-1"
          >
            <div className="relative min-w-0 flex-1">
              {/* Before the isPending branch: a district-gated query is neither
                pending-with-a-request nor errored, so that branch would
                otherwise spin forever. */}
              {isUnresolvable && (
                <p className="p-4 text-sm text-muted-foreground">
                  {districtUnavailableMessage(serveMode)}
                </p>
              )}
              {/* One loader for the walk: MapLoader shows behind the walk
                drawer while EITHER the pack downloads OR the walk's own
                route hydrates. The canvas dynamic-import fallback uses
                the same component, so pack-load → chunk-load → route-
                fetch → real canvas is one continuous surface, no swap.
                Gated on walkTurf so the create-flow arrival stays with
                its own in-sheet loading copy — putting MapLoader behind
                that sheet would print two competing loaders on one
                screen.

                The `routePending` half is what makes a fresh Build-route
                landing look like a "Continue knocking" landing: on Build
                route the pack is already warm from the create flow, so
                only the route is left to fetch — without this OR, that
                second wait sat silently on a bare district. */}
              {walkTurf &&
                !isUnresolvable &&
                (!packQuery.data || walkMap.routePending) && (
                  <MapLoader bottomPadPx={mapControlsOffset} />
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
                  // Every other turf recedes while one is being edited, so
                  // the boundary under the cursor reads as the foreground.
                  //
                  // The id handed over is the turf being edited, and it is
                  // deliberately one `turfs` does not contain — that turf is
                  // drawn by the drawing session instead (see `visibleTurfs`).
                  // `turfInteractiveAlpha` reads this as "a selection is live
                  // and this turf is not it" and pulls every ring back, which
                  // is exactly the backdrop wanted. Null off the flow leaves
                  // the layer at rest, byte-identical to before.
                  selectedTurfId={
                    activeDraftId === null ? null : draftTurfId(activeDraftId)
                  }
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
                  resumeDrawToken={draw.resumeDrawToken}
                  // Picking an earlier turf out of the drawing surface's
                  // toolbar puts its boundary back under the cursor.
                  loadDrawToken={draw.loadDrawToken}
                  loadDrawRing={draw.loadDrawRing}
                  clearDrawToken={draw.clearDrawToken}
                  undoDrawToken={draw.undoDrawToken}
                  // The colour a new list is drawn in, on the boundary being cut
                  // — state the map reads, so it lives up here.
                  drawColor={ringColor}
                  // Same overCap the create flow gates Continue on. Swaps the
                  // boundary's hue to destructive red so the map itself says
                  // this shape won't route — matching the count pill's error
                  // state on the drawing surface above.
                  drawOverCap={(turfStats?.stops ?? 0) > HARD_STOP_LIMIT}
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
                  controlsBottomPx={mapControlsOffset ?? 16}
                  onUndoDrawPoint={
                    draw.fullScreen && draw.pointCount > 0
                      ? draw.undoPoint
                      : undefined
                  }
                  drawStopCount={turfStats?.stops ?? 0}
                  drawStopsOverCap={(turfStats?.stops ?? 0) > HARD_STOP_LIMIT}
                  // Route framing padding — reuses the same sheet-height
                  // measurement the controls do, so the pins land in the
                  // visible band above the walk sheet as it snaps between
                  // peek/half/full. Null on the create-flow (no sheet
                  // occluding the map's route area) and on `full` snap (map
                  // fully covered).
                  routeFrameBottomPx={mapControlsOffset}
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
                  onPolygonChange={handlePolygonChange}
                  onDrawPointCount={draw.onPointCount}
                  onRoutePinClick={walkMap.onPinTap}
                />
              )}
              <WalkMapHint visible={walkMap.hintVisible} />
              {/* Inside the map column, not beside it, so the drawing
                  surface's own chrome covers the MAP and nothing else.
                  `DrawFullScreen` is `absolute inset-0`, so whichever
                  element is its containing block is what its footer bar
                  spans — mounted one level up, that bar ran the full
                  width of the row and sat over the bottom 81px of the
                  turf panel, which a long enough list would scroll
                  under. The flow's own sheet is unaffected: vaul
                  portals it to the body, so it is `fixed` wherever this
                  is mounted. */}
              {flowStep && (
                <CreateListSurface
                  step={flowStep}
                  filters={filters}
                  onFiltersChange={setFilters}
                  precincts={precincts}
                  onPrecinctsChange={setPrecincts}
                  precinctOptions={precinctOptions}
                  onStepChange={changeFlowStep}
                  onClose={closeFlow}
                  districtBounds={districtBounds}
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
                  drawPointCount={draw.pointCount}
                  drawFullScreen={draw.fullScreen}
                  onDrawFullScreenChange={openDrawing}
                  onRestartDrawing={draw.startDrawing}
                  onStartKnocking={handleStartKnocking}
                  isServeOrg={isServeOrg}
                  unpreviewableKeys={unpreviewableKeys}
                  orgSlug={organization?.slug}
                  preselectedListId={carriedListId}
                  onPreselectApplied={() =>
                    setSpentPreselectId(preselectedListId)
                  }
                  siblingTurfs={siblingTurfs}
                  campaignOutreachId={campaignOutreachId}
                  turfDrafts={turfDrafts}
                  draftStats={draftStats}
                  onSelectDraft={selectDraft}
                  onRemoveDraft={removeDraft}
                  preselectedRecommendedVariant={carriedVariant}
                  onRecommendedPreselectApplied={() =>
                    setSpentPreselectVariant(preselectedRecommendedVariant)
                  }
                />
              )}
            </div>
            {/* The drawing surface's configuration panel, and the reason it
                is mounted HERE rather than inside the flow: at `lg` it is a
                flex sibling of the map column, so the map shrinks to make
                room instead of being covered. Only the page owns that row.
                Below `lg` the panel goes over the map as a bottom sheet, and
                this row is `relative`, so the same element positions itself
                against it without a second mount.

                The data is all the page's already — the drafts, their stats,
                which one is active, and every writer. Only the roster is
                fetched, and `useTeamOptions` shares its cache key with the
                draw step's own read, so the two cost one request. */}
            {flowStep === 'draw' && draw.fullScreen && (
              <TurfPanel
                drafts={turfDrafts}
                active={activeDraft}
                pendingName={pendingName}
                drawColor={ringColor}
                draftStats={draftStats}
                savedTurfNames={(siblingTurfs ?? []).map((turf) => turf.name)}
                team={teamOptions}
                onSelectDraft={selectDraft}
                onStartNewTurf={startNextTurf}
                onRemoveDraft={removeDraft}
                onDiscardPendingTurf={discardPendingTurf}
                onPickColor={pickActiveColor}
                onRename={renameActiveTurf}
                pendingAssigneeId={pendingAssigneeId}
                onAssign={(assigneeId) => {
                  // Before the third corner there is no draft to write to,
                  // so the answer is held and stamped onto the turf when it
                  // commits. The panel's card is open from the start and
                  // must not offer a control that quietly does nothing.
                  if (!activeDraft) {
                    setPendingAssigneeId(assigneeId)
                    return
                  }
                  updateDraft(activeDraft.clientId, { assigneeId })
                }}
                onSave={() => closeDrawing()}
                // The cap is about the shape being drawn RIGHT NOW: a
                // committed turf was under it when it committed, and the one
                // in progress is what can still be fixed. Deliberately not
                // also gated on having a turf — see the panel's footer.
                saveDisabled={(turfStats?.stops ?? 0) > HARD_STOP_LIMIT}
                onCancel={cancelDrawing}
                dirty={sessionDirty}
                onMapControlsOffsetChange={setMapControlsOffset}
              />
            )}
            {/* Above every surface, including the map: this is the frame after
              the walk or the flow has been torn down and before the hub has
              arrived, and the whole point is that the map underneath is not
              what gets shown in it. */}
            {leaving && (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-background">
                <Spinner />
              </div>
            )}
            {walkSurface()}
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
        {/* No `suggested`, deliberately. Walking or driving is a question
            about how far apart the turf's OWN doors are, and those are
            frozen server-side — the only audience this page can measure a
            polygon against is whatever the create flow currently has
            selected, which for a saved turf (or a deep link, which starts
            with none) is a different set of people. A suggestion computed
            from the wrong audience is worse than none, so the dialog opens
            on walking until the server can answer. */}
        <StartKnockingDialog
          turf={knockPrompt?.turf ?? null}
          onOpenChange={(open) => {
            if (!open) setKnockPrompt(null)
          }}
          onRouteBuilt={handleRouteBuilt}
        />
      </DashboardLayout>
    </DoorKnockingSurface>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  transformVoterFileFiltersForBackend,
  type VoterFileFilters,
} from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import {
  addressPreviewQueryOptions,
  audienceCheckQueryOptions,
  savedListsQueryOptions,
  TURF_COLORS,
} from './turfQueries'
import { voterPackQueryOptions } from './useVoterPack'
import { savedListUnshadeableCriteria } from './savedListFilters'
import { hasEmptiableCriteria } from './createFlow/emptiableCriteria'
import CreateListFlow from './createFlow/CreateListFlow'
import type {
  CreateFlowStep,
  RecommendedCriteria,
} from './createFlow/CreateListFlow'
import type {
  DoorKnockingTurf,
  RecommendedListVariant,
} from '@goodparty_org/contracts'
import type { TurfDraft } from './turfDrafts'
import { audienceOptions } from './createFlow/savedListOptions'
import type { PrecinctOptionsResult } from 'app/dashboard/contacts/crm/wizard/usePrecinctOptions'
import type { PolygonRing } from './VoterMapCanvas'
import type { PolygonStats } from './filterEngine'

// A module constant so the initial state is the same object on every render
// and cannot itself churn the preview's memo.
const NO_RECOMMENDED_CRITERIA: RecommendedCriteria = {
  precincts: [],
  supportStatus: [],
}

// The create-list surface's half of the shared map, as a hook the orchestrator
// calls at the top level: the tokens are consumed by the canvas, which outlives
// the flow, so this state cannot live inside the panel below. Everything here
// is a request TO the canvas or a fact FROM it — the canvas owns the ring
// itself, so Undo and Clear are asks rather than edits made in the flow.
//
// The chosen list colour is a request of the same kind, which is why it moved
// up here out of the confirm step's own `useState`: the ring the candidate is
// judging the colour against is drawn by the canvas, and by this directory's
// rule state the map reads cannot live in a component the page unmounts. So is
// the framing — a step that covers part of the map asks for the shape back in
// view, and the canvas is the only thing holding the camera.
//
// Kept beside the panel because both halves are one surface's contract: an
// agent changing what the draw step asks of the map changes this file, and the
// orchestrator only ever spreads the result onto `VoterMapCanvas`.
// `seedColor` is the palette slot a candidate should land on when the flow
// opens: `TURF_COLORS[0]` for a solo campaign, or `assignNextColor(...)`
// off the anchor's siblings when the create is joining an existing
// campaign. Passing it in rather than deriving it here keeps the hook
// unaware of the campaign fetch — the surface is the one place that knows
// whether siblings exist. It re-seeds when the value changes, but never
// clobbers a colour the candidate has since picked (see the effect below).
export const useCreateListDraw = (seedColor: string = TURF_COLORS[0]) => {
  const [startDrawToken, setStartDrawToken] = useState(0)
  const [resumeDrawToken, setResumeDrawToken] = useState(0)
  const [loadDrawToken, setLoadDrawToken] = useState(0)
  const [loadDrawRing, setLoadDrawRing] = useState<PolygonRing | null>(null)
  const [clearDrawToken, setClearDrawToken] = useState(0)
  const [undoDrawToken, setUndoDrawToken] = useState(0)
  const [frameDrawToken, setFrameDrawToken] = useState(0)
  const [pointCount, setPointCount] = useState(0)
  // The colour of the in-progress ring. Two writers, and which of them wins
  // is the whole reason `colorPicked` exists beside it: the seed is the
  // palette's next free slot, recomputed whenever the campaign's turfs
  // change, and it must not overwrite a hue the candidate chose by hand on
  // the toolbar's picker. So the seed effect stands down once a turf has been
  // picked for, and `startNewTurf` below is what puts the assigner back in
  // charge — a NEW turf has no candidate choice behind it yet.
  const [drawColor, setDrawColor] = useState<string>(seedColor)
  const colorPicked = useRef(false)
  useEffect(() => {
    if (colorPicked.current) return
    setDrawColor(seedColor)
  }, [seedColor])
  // Whether the map is uncovered and being drawn on. It belongs here rather
  // than inside the flow for the reason everything else in this hook does: it
  // is a fact about what the CANVAS is doing. The draw step's shielded preview
  // window and the full-screen drawing surface are the same map in two states,
  // and the map outlives the panel that switches between them — the page also
  // reads it to decide whether maplibre's own controls are reachable.
  const [fullScreen, setFullScreen] = useState(false)

  return {
    startDrawToken,
    resumeDrawToken,
    loadDrawToken,
    loadDrawRing,
    clearDrawToken,
    undoDrawToken,
    frameDrawToken,
    pointCount,
    onPointCount: setPointCount,
    // The colour the in-progress ring is drawn in. Defaults to the seed
    // (palette[0] for a solo turf; the assigner's next-slot answer when
    // joining a campaign) and is overridden by the drawing surface's own
    // picker through `pickColor` below.
    drawColor,
    // Nothing covers the map on the drawing surface, so the ring is fitted
    // into the whole of it.
    frameDrawBottomPct: 0,
    fullScreen,
    // Uncovering the map: put the shape back in view. Coming back to the
    // drawing surface from the confirm step is the case that needs it — the
    // camera has not moved, but a candidate who has been reading a form for a
    // minute has no idea where their boundary is. Not fired by the ring
    // changing: while they draw, the canvasser is the one aiming the camera.
    setFullScreen: (full: boolean) => {
      setFullScreen(full)
      if (full) setFrameDrawToken((token) => token + 1)
    },
    // Arriving at the draw step with nothing drawn yet: a fresh drawing
    // session, on an empty map.
    startDrawing: () => setStartDrawToken((token) => token + 1),
    // Coming back to the draw step with a boundary already cut: re-enter
    // drawing mode and leave the shape alone.
    //
    // A second operation rather than a flag inside `startDrawing`, because the
    // distinction belongs to the caller and not to this hook. `startDrawing`
    // is also handed down as `onRestartDrawing` — the discard-the-turf action,
    // which must keep wiping whether or not a ring exists. (It is currently
    // unreachable: the "Discard this turf?" prompt was removed from the
    // drawing surface's Back, see `CreateListFlow.leaveFullScreen`.) A hook
    // that decided for itself by looking at the ring would get one of the two
    // callers right and quietly break the other the day it comes back.
    resumeDrawing: () => setResumeDrawToken((token) => token + 1),
    // Putting a turf the candidate already cut back under the cursor, so its
    // corners can be moved again. The colour rides along because the ring is
    // drawn in it: loading Turf 2's boundary while the canvas is still tinted
    // for Turf 3 would put one turf's shape on screen in another's hue, which
    // is the one thing the palette exists to prevent.
    //
    // `colorPicked` is set because a loaded turf HAS a colour — the assigner's
    // next-free-slot answer is about the next NEW turf and must not repaint
    // one that already exists.
    loadRing: (ring: PolygonRing, color: string) => {
      colorPicked.current = true
      setDrawColor(color)
      setLoadDrawRing(ring)
      setLoadDrawToken((token) => token + 1)
    },
    // Starting the next turf of a multi-turf campaign: an empty session, and
    // the assigner back in charge of the hue. Distinct from `startDrawing`
    // only in that it releases the candidate's pick — the seed is recomputed
    // from the turfs that now exist, so consecutive turfs walk the palette.
    startNewTurf: (color: string) => {
      colorPicked.current = false
      setDrawColor(color)
      setStartDrawToken((token) => token + 1)
    },
    // The toolbar's colour picker. Marks the hue as the candidate's so the
    // seed effect stops overwriting it — without the guard, committing a
    // draft recomputes the seed and repaints the ring they just chose for.
    pickColor: (color: string) => {
      colorPicked.current = true
      setDrawColor(color)
    },
    undoPoint: () => setUndoDrawToken((token) => token + 1),
    // Leaving the flow entirely: empty the shape rather than restart a session.
    // The colour and the drawing surface reset with it, which a component that
    // was unmounted would get for free — this hook outlives the flow, so what
    // the unmount did has to be said out loud.
    clearDrawing: () => {
      setClearDrawToken((token) => token + 1)
      // Rewind to the seed rather than to a fixed palette[0]: the next
      // create should start on whichever slot the assigner recommends
      // right now — a solo campaign gets palette[0], a candidate opening
      // "Add another turf" on a two-turf campaign gets palette[2].
      //
      // The candidate's pick is released with it. This is the end of a
      // create, so the hue they chose for the last turf of it has no claim
      // on the first turf of the next one.
      colorPicked.current = false
      setDrawColor(seedColor)
      setLoadDrawRing(null)
      setFullScreen(false)
    },
  }
}

// SEAM — the create-list flow (Wave 1B).
//
// This surface owns: every step of the wizard and everything a step asks of
// gp-api. That is now the whole address-preview machinery (ADR 0010) — which
// shape was asked about, whether the answer still describes it, and the four
// props the draw step reads off it — because nothing outside this flow has
// ever read a preview. It also owns the who step's list picker and the
// district counts beside it, for the same reason: nothing outside this flow
// asks that question either.
//
// The wizard is purpose → who → draw → confirm → route, with a `name` step
// that branches off the who step and ends the flow by saving a reusable
// audience. The three pre-draw stages live inside the page's single `filters`
// step, so that phase grew without the orchestrator learning about them. See
// `createFlow/createFlowSteps.ts` — the page starts a drawing session on
// exactly the `filters` → `draw` transition, so that pair has to stay the
// boundary between deciding an audience and cutting a shape however many
// stages the deciding takes.
//
// The route step is a page step rather than a fourth hidden stage because it
// is on the far side of `confirm`, and the page reads `step` to decide what
// covers the map.
//
// The orchestrator owns: the map, and therefore everything the map also reads.
// `filters` shades dots while the flow is open and `ring` comes back off the
// canvas, so both live up there and arrive as props. So does `step`: the page
// hides the rail, masks the dots and gates the header button on it.
export interface CreateListSurfaceProps {
  step: CreateFlowStep
  filters: VoterFileFilters
  onFiltersChange: (filters: VoterFileFilters) => void
  onStepChange: (step: CreateFlowStep) => void
  onClose: () => void
  // The pack's bounding box, threaded to the draw step's static-map
  // preview card. Null while the pack decodes; the preview omits the image
  // in that window rather than rendering against no rect.
  districtBounds: [[number, number], [number, number]] | null
  // District-wide households matching the filter draft. Honest only on the
  // filters step, where no polygon exists yet.
  districtHouseholds: number
  // Whether that count is a real answer yet. It is computed in the browser from
  // the decoded pack, which takes seconds to tens of seconds to arrive, and
  // until it does the count above is 0 — a number indistinguishable from a
  // district with nobody in it. The pack is the orchestrator's, so its state
  // crosses the seam with the count it explains rather than being re-observed
  // down here.
  districtHouseholdsPending: boolean
  districtHouseholdsFailed: boolean
  // The third case, which is neither of the two above: this org's district
  // does not resolve, so no pack was ever requested.
  districtUnavailable: boolean
  // The shape currently on the canvas. Reference identity is load-bearing: the
  // canvas emits a fresh array per change, and comparing it against the ring a
  // preview was asked about is what makes an answer belong to a boundary.
  ring: PolygonRing | null
  // In-polygon counts from the pack — instant on every ring change, and a
  // superset. The preview below replaces these once it answers.

  // Boundary points placed so far, straight off the canvas. `ring` only exists
  // from three points, so this is the only thing that knows there is a one- or
  // two-point shape to undo.
  drawPointCount: number
  // Drop the most recently placed vertex. Threaded through to the drawing
  // surface's Undo button.

  // Whether the map is uncovered and live. Owned by `useCreateListDraw` above
  // — it is a fact about the canvas, which outlives this surface.
  drawFullScreen: boolean
  onDrawFullScreenChange: (full: boolean, origin?: DOMRect) => void
  // What covers the bottom of the map, so the drawing surface's own chrome
  // clears it by the same number the zoom cluster does. Threaded straight
  // through — the turf panel measures it and the page holds it.

  // Discarding the drawn boundary. Bumps `startDrawToken` rather than
  // `clearDrawToken`: the canvas keeps a live drawing session behind the draw
  // step's shield, and clearing would end it and leave a map nothing can be
  // drawn on. Up on the page with the other draw tokens for the usual reason —
  // the map outlives this surface.
  onRestartDrawing: () => void
  // The drawn shape's stops as [lng, lat], for the route step's walk-vs-drive
  // suggestion. From the pack, which is the orchestrator's.
  drawnStops: Array<[number, number]> | null
  onStartKnocking: (turf: DoorKnockingTurf) => void
  // Hides the Win-only filters, same contract as the CRM wizard's
  // VoterFileStep. A prop rather than a context read so this stays testable
  // without an organization provider.
  isServeOrg: boolean
  // The hand-cut precinct selection and the district's precinct vocabulary.
  // Owned by the orchestrator alongside `filters` — the address preview
  // assembled below is what needs them, and the query is the page's.
  precincts: string[]
  onPrecinctsChange: (value: string[]) => void
  precinctOptions: PrecinctOptionsResult
  // Draft selections the pack can't shade, computed by the orchestrator
  // because it owns the pack's manifest for the map's sake.
  unpreviewableKeys: string[]
  // The organization the recommendations are asked for, threaded down purely
  // as a cache-key segment.
  orgSlug: string | undefined
  // A saved list the candidate arrived with (`?listId=`), for the who step's
  // picker to open on. Passed through rather than resolved here: the picker's
  // rows are the only honest test of whether the id still names one of this
  // org's lists, and they are built one component down.
  preselectedListId?: number
  // Raised once the who step has taken the carried list, so the page can stop
  // handing it back on the next open of this flow.
  onPreselectApplied?: () => void
  // The turfs already in this campaign, threaded to the flow so the name
  // step can default to `Turf N`. Undefined for a solo (self-anchored)
  // create. A future per-turf picker on the drawing step will also read
  // these to pick a palette slot the campaign has not already used.
  siblingTurfs?: DoorKnockingTurf[]
  // The anchor Outreach id this new turf should join, when the drawer's
  // "Add another turf" opens the flow with `?campaignOutreachId=`. Threaded
  // straight through — the surface never resolves it.
  campaignOutreachId?: number
  // The turfs cut in this sitting but not yet paid for. Owned by the page
  // because the canvas draws them; threaded down so the draw step can list
  // them and the save can buy a route for each.
  //
  // Nothing here COMMITS one, and nothing here CONFIGURES one either. A turf
  // becomes a draft the moment its ring is valid, which only the page can
  // see; and naming, colouring and assigning happen in `TurfPanel`, which
  // the page mounts beside the map. What crosses this seam is the two things
  // the STEP can do to a turf — reopen it, or drop it.
  turfDrafts: TurfDraft[]
  // The pack's stops/doors/people for each draft, keyed by `clientId`. From
  // the orchestrator because the pack is: this surface never decodes one.
  // A draft missing from the map has no answer yet and prints as such.
  draftStats: Map<string, PolygonStats>
  onSelectDraft: (clientId: string) => void
  onRemoveDraft: (clientId: string) => void
  // The same pair for a recommendation carried in on `?recommended=`.
  preselectedRecommendedVariant?: RecommendedListVariant
  onRecommendedPreselectApplied?: () => void
}

export default function CreateListSurface({
  step,
  filters,
  onFiltersChange,
  onStepChange,
  onClose,
  districtBounds,
  districtHouseholds,
  districtHouseholdsPending,
  districtHouseholdsFailed,
  districtUnavailable,
  ring,
  drawPointCount,
  drawFullScreen,
  onDrawFullScreenChange,
  onRestartDrawing,
  drawnStops,
  onStartKnocking,
  isServeOrg,
  precincts,
  onPrecinctsChange,
  precinctOptions,
  unpreviewableKeys,
  orgSlug,
  preselectedListId,
  onPreselectApplied,
  siblingTurfs,
  campaignOutreachId,
  turfDrafts,
  draftStats,
  onSelectDraft,
  onRemoveDraft,
  preselectedRecommendedVariant,
  onRecommendedPreselectApplied,
}: CreateListSurfaceProps) {
  // The who step's list picker. Both reads are the page's own queries by key,
  // so this costs nothing: the saved lists are already warm (the rail resolves
  // every turf's filter through them) and the pack is `enabled: false` because
  // fetching one is emphatically not this surface's job — the page owns it,
  // gates the whole feature on it, and disables the button that opens this
  // flow until it has decoded. Reading it through an observer rather than
  // `getQueryData` is what makes the counts appear if it lands late.
  //
  // Above the preview rather than below it because the preview request now
  // reads from it: a picked list's clauses are part of what is asked.
  const savedListsQuery = useQuery(savedListsQueryOptions)
  const packQuery = useQuery({ ...voterPackQueryOptions, enabled: false })
  const audience = useMemo(
    () =>
      audienceOptions(savedListsQuery.data, packQuery.data ?? null, isServeOrg),
    [savedListsQuery.data, packQuery.data, isServeOrg],
  )
  // Which list the who step is on, resolved against the same rows the picker
  // is drawn from. The flow owns the choice and reports the id; the row it
  // names is looked up once, here, so the preview cannot come to disagree
  // with the picker about what a list carries.
  const [selectedListId, setSelectedListId] = useState<number | null>(null)
  // An accepted recommendation is a list that does not exist yet, so there is
  // no row to look its clauses up in — the flow reports them by value.
  const [recommendedCriteria, setRecommendedCriteria] =
    useState<RecommendedCriteria>(NO_RECOMMENDED_CRITERIA)
  // Stable, so the flow's own report effect isn't re-run by this component
  // re-rendering. The flow memoises the criteria object it hands over, so
  // both setters bail out when nothing has actually changed.
  const handleSelectedListChange = useCallback(
    (listId: number | null, criteria: RecommendedCriteria) => {
      setSelectedListId(listId)
      setRecommendedCriteria(criteria)
    },
    [],
  )
  const selectedList = useMemo(
    () => savedListsQuery.data?.find((list) => list.id === selectedListId),
    [savedListsQuery.data, selectedListId],
  )

  // The shape the candidate asked for addresses about (ADR 0010). Not a
  // boolean, because it is what makes an answer belong to one ring: a preview
  // is fetched for the shape that was on screen when it was asked for, and a
  // vertex moved since means the list on screen describes a boundary that no
  // longer exists. Null is the panel shut, and shut is also what pays
  // nothing — no request is ever made by drawing.
  const [previewRing, setPreviewRing] = useState<PolygonRing | null>(null)
  // The addresses inside the shape that was asked about, from gp-api's
  // evaluation rather than from the pack — the pack carries no address at all
  // (ADR 0010). Closing the ring the way the save path does, so the polygon
  // previewed and the polygon saved are the same geometry.
  const previewPolygon = useMemo(() => {
    if (!previewRing) return null
    const closed =
      previewRing[0]?.[0] !== previewRing[previewRing.length - 1]?.[0] ||
      previewRing[0]?.[1] !== previewRing[previewRing.length - 1]?.[1]
        ? [...previewRing, previewRing[0] as [number, number]]
        : previewRing
    return { type: 'Polygon' as const, coordinates: [closed] }
  }, [previewRing])
  // The draft plus whatever the draft cannot hold. `filters` is booleans, and
  // a saved list's support-status, activity and precinct clauses are not — so
  // assembling this request from the draft alone asked gp-api about the whole
  // district inside the ring, and the draw step printed that as the exact
  // count the route would be built from (ADR 0010's whole point is that these
  // counts are the knock's own). The pack cannot shade those clauses and says
  // so; this endpoint CAN evaluate them, and does.
  //
  // An accepted recommendation is the same gap from the other direction: it
  // carries precincts and support status and has no saved row to read them
  // off, and precincts are the ONLY thing that narrows a door list — so
  // without them the preview's `stops` (which drives the hard stop cap on the
  // paid route) answers for the whole district. The two sources are mutually
  // exclusive: picking a list clears the recommendation draft and editing a
  // pill clears it too.
  const previewFilters = useMemo(
    () => ({
      ...transformVoterFileFiltersForBackend(filters),
      ...savedListUnshadeableCriteria(selectedList),
      // The hand-cut precinct selection is the third mutually-exclusive
      // source of a precinct clause, beside a picked list's and an accepted
      // recommendation's: each of the three clears the other two.
      ...(precincts.length ? { precincts } : {}),
      ...(recommendedCriteria.precincts.length
        ? { precincts: recommendedCriteria.precincts }
        : {}),
      ...(recommendedCriteria.supportStatus.length
        ? { supportStatus: recommendedCriteria.supportStatus }
        : {}),
    }),
    [filters, selectedList, precincts, recommendedCriteria],
  )
  // Does this audience keep anybody? Asked of the same filter payload the
  // preview sends, and asked HERE rather than beside the picker because this
  // is where that payload is assembled — a list's support-status and activity
  // clauses live outside the boolean draft, so the who step itself cannot see
  // what it just picked.
  //
  // Only fires for a draft carrying a criterion that can resolve to nobody.
  // Everything else narrows a people-db query instead of resolving a set, so
  // the answer for it is `empty: false` before the request is made and the
  // round trip would buy nothing.
  const audienceCheckQuery = useQuery({
    ...audienceCheckQueryOptions(previewFilters),
    enabled: hasEmptiableCriteria(previewFilters),
  })
  // Fails open, both while pending and on error. A candidate must never be
  // held out of their own flow by an advisory check: the create's own
  // refusal is still behind this, so the cost of missing an empty audience is
  // the status quo, while the cost of a false block is a list that cannot be
  // cut at all. `data` is undefined in both states, so the `=== true` is the
  // whole of that policy.
  const audienceEmpty = audienceCheckQuery.data?.empty === true

  const previewQuery = useQuery({
    ...addressPreviewQueryOptions(
      previewPolygon ?? { type: 'Polygon', coordinates: [[]] },
      previewFilters,
    ),
    // Gated on the draw step as well as on the ring, because the ring
    // OUTLIVES that step: Back keeps it and so does Continue. Without the
    // step here, a panel left open and backed out of would re-fetch behind a
    // list nobody can see. The resets below are the behaviour; this gate is
    // what stops the invariant depending on every call site remembering it.
    enabled: previewPolygon !== null && step === 'draw',
  })
  // A preview describes the ring it was asked about. Once a vertex moves it
  // describes a boundary that is no longer on screen, so it stops being an
  // answer — the panel says the boundary changed and the draw step goes back
  // to reporting the pack's estimate, together, in one render. Nothing
  // refetches on its own: re-asking is the candidate's press.
  const previewCurrent = previewRing !== null && previewRing === ring
  const addressPreview = previewCurrent ? (previewQuery.data ?? null) : null

  return (
    <CreateListFlow
      step={step}
      filters={filters}
      onFiltersChange={onFiltersChange}
      precincts={precincts}
      onPrecinctsChange={onPrecinctsChange}
      precinctOptions={precinctOptions}
      onStepChange={(next) => {
        // Back to the filters is a re-cut of the audience, and the step
        // forward from it wipes the shape — so the next thing drawn is a
        // different list against a different question. A doors panel left open
        // would spring back over it with nobody having asked. Continuing to
        // confirm deliberately does NOT reset it: that is one shape being
        // reviewed, and Back has to return the step as it was left.
        if (next === 'filters') setPreviewRing(null)
        onStepChange(next)
      }}
      onClose={onClose}
      districtBounds={districtBounds}
      districtHouseholds={districtHouseholds}
      districtHouseholdsPending={districtHouseholdsPending}
      districtHouseholdsFailed={districtHouseholdsFailed}
      districtUnavailable={districtUnavailable}
      audienceEmpty={audienceEmpty}
      savedLists={audience.lists}
      allContactsHouseholds={audience.allContactsHouseholds}
      ring={ring}
      addressPreview={addressPreview}
      previewPending={previewCurrent && previewQuery.isPending}
      previewFailed={previewCurrent && previewQuery.isError}
      // Open-but-for-another-shape: the list on screen described a boundary
      // that has since moved, so the panel says so instead of showing it, and
      // the counts revert to the pack in the same render.
      previewStale={previewRing !== null && !previewCurrent}
      onShowAddresses={() => setPreviewRing(ring)}
      onHideAddresses={() => setPreviewRing(null)}
      // Re-asking for the same shape is a refetch, not a state change: the
      // ring hasn't moved, so setting it again would be the same value and
      // nothing would go out.
      onRetryAddresses={() => void previewQuery.refetch()}
      drawPointCount={drawPointCount}
      drawFullScreen={drawFullScreen}
      onDrawFullScreenChange={onDrawFullScreenChange}
      onRestartDrawing={onRestartDrawing}
      drawnStops={drawnStops}
      onStartKnocking={onStartKnocking}
      isServeOrg={isServeOrg}
      unpreviewableKeys={unpreviewableKeys}
      orgSlug={orgSlug}
      preselectedListId={preselectedListId}
      onPreselectApplied={onPreselectApplied}
      preselectedRecommendedVariant={preselectedRecommendedVariant}
      onRecommendedPreselectApplied={onRecommendedPreselectApplied}
      onSelectedListChange={handleSelectedListChange}
      siblingTurfs={siblingTurfs}
      campaignOutreachId={campaignOutreachId}
      turfDrafts={turfDrafts}
      draftStats={draftStats}
      onSelectDraft={onSelectDraft}
      onRemoveDraft={onRemoveDraft}
    />
  )
}

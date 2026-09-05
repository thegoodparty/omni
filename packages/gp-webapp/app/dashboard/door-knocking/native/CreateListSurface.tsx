'use client'

import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  transformVoterFileFiltersForBackend,
  type VoterFileFilters,
} from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import {
  addressPreviewQueryOptions,
  savedListsQueryOptions,
  TURF_COLORS,
} from './turfQueries'
import { voterPackQueryOptions } from './useVoterPack'
import { savedListUnshadeableCriteria } from './savedListFilters'
import CreateListFlow from './createFlow/CreateListFlow'
import type {
  CreateFlowStep,
  RecommendedCriteria,
} from './createFlow/CreateListFlow'
import type { DoorKnockingTurf } from '@goodparty_org/contracts'
import { audienceOptions } from './createFlow/savedListOptions'
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
export const useCreateListDraw = () => {
  const [startDrawToken, setStartDrawToken] = useState(0)
  const [clearDrawToken, setClearDrawToken] = useState(0)
  const [undoDrawToken, setUndoDrawToken] = useState(0)
  const [frameDrawToken, setFrameDrawToken] = useState(0)
  const [pointCount, setPointCount] = useState(0)
  const [drawColor, setDrawColor] = useState<string>(TURF_COLORS[0])
  // Whether the map is uncovered and being drawn on. It belongs here rather
  // than inside the flow for the reason everything else in this hook does: it
  // is a fact about what the CANVAS is doing. The draw step's shielded preview
  // window and the full-screen drawing surface are the same map in two states,
  // and the map outlives the panel that switches between them — the page also
  // reads it to decide whether maplibre's own controls are reachable.
  const [fullScreen, setFullScreen] = useState(false)

  return {
    startDrawToken,
    clearDrawToken,
    undoDrawToken,
    frameDrawToken,
    pointCount,
    onPointCount: setPointCount,
    // The colour a new list is drawn in. Auto-assigned rather than picked —
    // the canvas's confirm step is a single name field — but still the map's
    // to know, because it tints the ring while it is being cut.
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
    // Entering the draw step: a fresh drawing session.
    startDrawing: () => setStartDrawToken((token) => token + 1),
    undoPoint: () => setUndoDrawToken((token) => token + 1),
    // Leaving the flow entirely: empty the shape rather than restart a session.
    // The colour and the drawing surface reset with it, which a component that
    // was unmounted would get for free — this hook outlives the flow, so what
    // the unmount did has to be said out loud.
    clearDrawing: () => {
      setClearDrawToken((token) => token + 1)
      setDrawColor(TURF_COLORS[0])
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
  turfStats: PolygonStats | null
  // Boundary points placed so far, straight off the canvas. `ring` only exists
  // from three points, so this is the only thing that knows there is a one- or
  // two-point shape to undo.
  drawPointCount: number
  // Undo is a request to the canvas, which owns the in-progress ring. There is
  // no Clear beside it: the canvas's drawing surface offers one control, and
  // repeated Undo is what empties a shape.
  onUndoPoint: () => void
  // Whether the map is uncovered and live. Owned by `useCreateListDraw` above
  // — it is a fact about the canvas, which outlives this surface.
  drawFullScreen: boolean
  onDrawFullScreenChange: (full: boolean) => void
  // Discarding the drawn boundary. Bumps `startDrawToken` rather than
  // `clearDrawToken`: the canvas keeps a live drawing session behind the draw
  // step's shield, and clearing would end it and leave a map nothing can be
  // drawn on. Up on the page with the other draw tokens for the usual reason —
  // the map outlives this surface.
  onRestartDrawing: () => void
  // The colour the new list will be drawn in. Auto-assigned, not picked: the
  // canvas's confirm step is a single name field, and a list's colour stays
  // editable in `EditTurfDialog`. Up on the page because the canvas tints the
  // boundary with it while the shape is being cut.
  color: string
  // The drawn shape's stops as [lng, lat], for the route step's walk-vs-drive
  // suggestion. From the pack, which is the orchestrator's.
  drawnStops: Array<[number, number]> | null
  onListCreated: (turf: DoorKnockingTurf) => void
  // Hides the Win-only filters, same contract as the CRM wizard's
  // VoterFileStep. A prop rather than a context read so this stays testable
  // without an organization provider.
  isElectedOfficial: boolean
  // The pack's own bounding box, computed by the orchestrator alongside
  // filterResult (packBounds is a pure derivation of the pack the page
  // decodes). The draw step frames its static-map preview to this;
  // omitted (or null) means the preview renders without an image.
  districtBounds?: [[number, number], [number, number]] | null
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
}

export default function CreateListSurface({
  step,
  filters,
  onFiltersChange,
  onStepChange,
  onClose,
  districtHouseholds,
  districtHouseholdsPending,
  districtHouseholdsFailed,
  districtUnavailable,
  ring,
  turfStats,
  drawPointCount,
  onUndoPoint,
  drawFullScreen,
  onDrawFullScreenChange,
  onRestartDrawing,
  color,
  drawnStops,
  onListCreated,
  isElectedOfficial,
  districtBounds,
  orgSlug,
  preselectedListId,
  onPreselectApplied,
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
    () => audienceOptions(savedListsQuery.data, packQuery.data ?? null),
    [savedListsQuery.data, packQuery.data],
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
      ...(recommendedCriteria.precincts.length
        ? { precincts: recommendedCriteria.precincts }
        : {}),
      ...(recommendedCriteria.supportStatus.length
        ? { supportStatus: recommendedCriteria.supportStatus }
        : {}),
    }),
    [filters, selectedList, recommendedCriteria],
  )
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
      districtHouseholds={districtHouseholds}
      districtHouseholdsPending={districtHouseholdsPending}
      districtHouseholdsFailed={districtHouseholdsFailed}
      districtUnavailable={districtUnavailable}
      savedLists={audience.lists}
      allContactsHouseholds={audience.allContactsHouseholds}
      ring={ring}
      turfStats={turfStats}
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
      onUndoPoint={onUndoPoint}
      drawFullScreen={drawFullScreen}
      onDrawFullScreenChange={onDrawFullScreenChange}
      onRestartDrawing={onRestartDrawing}
      color={color}
      drawnStops={drawnStops}
      onListCreated={onListCreated}
      isElectedOfficial={isElectedOfficial}
      districtBounds={districtBounds}
      orgSlug={orgSlug}
      preselectedListId={preselectedListId}
      onPreselectApplied={onPreselectApplied}
      onSelectedListChange={handleSelectedListChange}
    />
  )
}

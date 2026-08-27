'use client'

import { useMemo, useState } from 'react'
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
import type { CreateFlowStep } from './createFlow/CreateListFlow'
import { CONFIRM_PEEK_TOP_PCT } from './createFlow/createFlowSteps'
import { audienceOptions } from './createFlow/savedListOptions'
import type { PolygonRing } from './VoterMapCanvas'
import type { PolygonStats } from './filterEngine'

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
export const useCreateListDraw = (step: CreateFlowStep | null) => {
  const [startDrawToken, setStartDrawToken] = useState(0)
  const [clearDrawToken, setClearDrawToken] = useState(0)
  const [undoDrawToken, setUndoDrawToken] = useState(0)
  const [frameDrawToken, setFrameDrawToken] = useState(0)
  const [pointCount, setPointCount] = useState(0)
  const [hintDismissed, setHintDismissed] = useState(false)
  const [drawColor, setDrawColor] = useState<string>(TURF_COLORS[0])

  return {
    startDrawToken,
    clearDrawToken,
    undoDrawToken,
    frameDrawToken,
    pointCount,
    onPointCount: setPointCount,
    // The colour the confirm step is picking, drawn on the ring it is picking it
    // for. Also handed back down to the flow, which renders the swatches.
    drawColor,
    onDrawColorChange: setDrawColor,
    // What the confirm sheet covers, since the peek is stated as the fraction it
    // leaves uncovered. Read off the sheet's own constant so its height and the
    // camera's padding cannot come to describe different bands.
    frameDrawBottomPct: 100 - CONFIRM_PEEK_TOP_PCT,
    // Entering a step that covers part of the map: put the shape in what is
    // left. Not fired by the ring changing — the canvasser is the one framing it
    // while they draw.
    frameDrawing: () => setFrameDrawToken((token) => token + 1),
    // A first-run coach mark, so it is gone the moment a point exists.
    hintVisible: step === 'draw' && !hintDismissed && pointCount === 0,
    dismissHint: () => setHintDismissed(true),
    // Entering the draw step: a fresh drawing session, and a canvasser who has
    // not seen the gesture yet.
    startDrawing: () => {
      setStartDrawToken((token) => token + 1)
      setHintDismissed(false)
    },
    // Clear reuses the start token, because a restarted drawing session (empty
    // ring, still in draw mode) is exactly the state Clear returns to; bumping
    // the clear token too would run deleteAll AFTER draw_polygon is entered and
    // kill the fresh session. The instruction card stays dismissed on purpose —
    // someone who just cleared has already learned the gesture.
    clearPoints: () => setStartDrawToken((token) => token + 1),
    undoPoint: () => setUndoDrawToken((token) => token + 1),
    // Leaving the flow entirely: empty the shape rather than restart a session.
    // The colour resets with it, which the confirm step used to get for free by
    // being unmounted — this hook outlives the flow, so what the unmount did has
    // to be said out loud. Same asymmetry `hiddenTurfIds` records on the page.
    clearDrawing: () => {
      setClearDrawToken((token) => token + 1)
      setDrawColor(TURF_COLORS[0])
    },
  }
}

// The draw step's coach mark, rendered over the map band rather than inside the
// flow's own chrome — it names the gesture the canvas exists for. A full-inset
// button so the dismissing tap can't also drop a stray vertex.
export const DrawHintOverlay = ({
  visible,
  onDismiss,
}: {
  visible: boolean
  onDismiss: () => void
}) => {
  if (!visible) return null
  return (
    <button
      type="button"
      aria-label="Dismiss map instructions"
      className="absolute inset-0 z-10 flex cursor-default items-center justify-center"
      onClick={onDismiss}
    >
      <div className="mx-4 max-w-sm rounded-xl border border-border bg-background p-5 text-center shadow-lg">
        <p className="font-semibold">Draw your knocking boundaries.</p>
        {/* Both facts a tester hunting for a Done button needs: three points
            is the minimum, and the shape closes itself. The Continue button
            carries them too, for whoever dismissed this card on their first
            tap. */}
        <p className="mt-1 text-sm text-muted-foreground">
          Tap three or more points around the doors you want to knock — the
          shape closes itself. Drag any point to adjust it.
        </p>
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-info">
          Tap the map to get started
        </p>
      </div>
    </button>
  )
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
// The wizard is now purpose → who → draw → confirm plus a conditional name
// step, and it grew those WITHOUT the orchestrator learning about them:
// `CreateFlowStep` still has its three frozen values, and the three pre-draw
// stages live inside `filters`. See `createFlow/createFlowSteps.ts` — the page
// starts a drawing session on exactly the `filters` → `draw` transition, so
// that pair has to stay the boundary between deciding an audience and cutting
// a shape however many stages the deciding takes.
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
  // Undo / Clear are requests to the canvas, which owns the in-progress ring.
  onUndoPoint: () => void
  onClearPoints: () => void
  // The colour the confirm step's picker is on. Up on the page for the same
  // reason the ring is: the canvas tints the boundary with it, and a candidate
  // choosing the colour their list will be drawn in with the map hidden is the
  // defect this closes. The flow still draws the swatches and reports the pick.
  color: string
  onColorChange: (color: string) => void
  onSaved: (drawAnother: boolean) => void
  // Hides the Win-only filters, same contract as the CRM wizard's
  // VoterFileStep. A prop rather than a context read so this stays testable
  // without an organization provider.
  isElectedOfficial: boolean
  // Draft selections the pack can't shade, computed by the orchestrator
  // because it owns the pack's manifest for the map's sake.
  unpreviewableKeys: string[]
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
  ring,
  turfStats,
  drawPointCount,
  onUndoPoint,
  onClearPoints,
  color,
  onColorChange,
  onSaved,
  isElectedOfficial,
  unpreviewableKeys,
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
  const previewFilters = useMemo(
    () => ({
      ...transformVoterFileFiltersForBackend(filters),
      ...savedListUnshadeableCriteria(selectedList),
    }),
    [filters, selectedList],
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
      onClearPoints={onClearPoints}
      color={color}
      onColorChange={onColorChange}
      onSaved={(drawAnother) => {
        // A saved list is finished business, so the next shape is asked about
        // from scratch — same rule as backing out to the filters.
        if (drawAnother) setPreviewRing(null)
        onSaved(drawAnother)
      }}
      isElectedOfficial={isElectedOfficial}
      unpreviewableKeys={unpreviewableKeys}
      preselectedListId={preselectedListId}
      onPreselectApplied={onPreselectApplied}
      onSelectedListChange={setSelectedListId}
    />
  )
}

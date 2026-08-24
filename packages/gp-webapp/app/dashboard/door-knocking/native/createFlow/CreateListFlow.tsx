'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  IconButton,
  Input,
  Label,
  Stepper,
  XMarkIcon,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  transformVoterFileFiltersForBackend,
  type VoterFileFilters,
} from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import { unpreviewableDisclosureLabels } from './voterFilterPreview'
import {
  flowStage,
  previousStage,
  stageStep,
  stepperPosition,
  type CreateFlowStage,
  type CreateFlowStep,
  type PreDrawStage,
} from './createFlowSteps'
import {
  doorKnockingPurposeNameSuggestion,
  type DoorKnockingPurpose,
} from './doorKnockingPurposes'
import { PurposeStep } from './PurposeStep'
import { WhoStep } from './WhoStep'
import { NameStep } from './NameStep'
import type { SavedListOption } from './savedListOptions'
import { MAX_TURF_NAME_LENGTH, TURF_COLORS } from '../turfQueries'
import { DOORS_PER_HOUR, estimateWalkTime } from '../walkEstimate'
import type { DoorKnockingAddressPreviewResponse } from '@goodparty_org/contracts'
import type { PolygonRing } from '../VoterMapCanvas'
import type { PolygonStats } from '../filterEngine'

export type { CreateFlowStep } from './createFlowSteps'

// Informational, not a gate: past this the evening is long enough to be worth
// saying out loud. The hard cap at 150 is what actually blocks.
const SOFT_STOP_LIMIT = 100
const HARD_STOP_LIMIT = 150
// The canvas closes the shape itself and only emits a ring from three points
// (VoterMapCanvas's onPolygonChange gate), so there is no Done to press and
// Continue cannot enable before then. Mirrored here rather than imported: the
// canvas module carries maplibre and deck.gl, and this flow is deliberately
// outside that chunk.
const MIN_POLYGON_POINTS = 3

interface CreateListFlowProps {
  step: CreateFlowStep
  filters: VoterFileFilters
  onFiltersChange: (filters: VoterFileFilters) => void
  onStepChange: (step: CreateFlowStep) => void
  onClose: () => void
  // District-wide households matching the filter draft. Honest only before a
  // polygon exists — once one is drawn, everything the draw step reports comes
  // off turfStats instead.
  districtHouseholds: number
  // The who step's list picker, with the parenthesised district counts the
  // canvas puts beside each row. Empty until the saved lists resolve; the step
  // still offers All contacts, which is the default anyway.
  savedLists: SavedListOption[]
  allContactsHouseholds: number | null
  ring: PolygonRing | null
  // In-polygon counts for the drawn shape, computed by the page from the pack.
  // The estimate: instant on every ring change, and a superset, since the pack
  // carries no addresses and cannot shade by every filter a list applies.
  turfStats: PolygonStats | null
  // gp-api's answer for the shape the candidate asked about — the addresses
  // themselves, and the exact counts that come with them. Non-null only while
  // it describes the ring currently on screen, and when it is non-null it is
  // what this step reports (ADR 0010): the estimate above becomes the loading
  // state for it rather than a second figure beside it.
  addressPreview: DoorKnockingAddressPreviewResponse | null
  previewPending: boolean
  previewFailed: boolean
  // Asked for, answered, and then a vertex moved. The answer describes a
  // boundary that is no longer on screen, so it is not shown and not counted.
  previewStale: boolean
  // Ask / stop asking / ask again. The page owns the request for the same
  // reason it owns Undo and Clear, and because a shut panel must never pay
  // for a scan of people-db.
  onShowAddresses: () => void
  onHideAddresses: () => void
  onRetryAddresses: () => void
  // Boundary points placed so far. `ring` only exists from three points, so
  // this is the only thing that knows there is a one- or two-point shape to
  // undo — and it counts adds, not drags, which never change the total.
  drawPointCount: number
  // Drop the last placed point / empty the shape. The canvas owns the ring,
  // so both are requests, not edits made here.
  onUndoPoint: () => void
  onClearPoints: () => void
  // Saved-flow completion: clear the drawing (and optionally exit).
  onSaved: (drawAnother: boolean) => void
  // Hides the Win-only filters, same contract as the CRM wizard's
  // VoterFileStep. A prop rather than a context read so this stays a plain
  // presentational flow and its tests don't need an organization provider.
  isElectedOfficial: boolean
  // Selected filter option keys the map preview can't narrow by, so the drawn
  // shape shows more people than the list will target.
  unpreviewableKeys: string[]
}

const STAGE_META: Record<CreateFlowStage, { title: string; caption: string }> =
  {
    purpose: {
      title: 'What do you want to do?',
      caption: 'Pick a goal so we can shape the right door knocking list.',
    },
    who: {
      title: 'Who do you want to reach?',
      caption: 'Start from a saved list, or filter the whole district.',
    },
    name: {
      title: 'Name your list',
      caption: 'Save this filter combination so you can target it again.',
    },
    draw: {
      title: 'Draw your door knocking boundaries',
      caption: 'Outline map areas to build targeted door lists.',
    },
    confirm: {
      title: 'Confirm your list',
      caption: 'Review the route, give it a name and color, then save it.',
    },
  }

const StepHeader = ({
  stage,
  needsName,
  onBack,
  onClose,
}: {
  stage: CreateFlowStage
  needsName: boolean
  onBack: (() => void) | null
  onClose: () => void
}) => {
  const meta = STAGE_META[stage]
  const { currentStep, totalSteps } = stepperPosition(stage, needsName)
  return (
    <div className="border-b border-border bg-background px-4 py-4 sm:px-6">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-start gap-3">
          {onBack && (
            <Button size="small" variant="ghost" onClick={onBack}>
              Back
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">{meta.title}</h2>
            <p className="text-sm text-muted-foreground">{meta.caption}</p>
          </div>
          <IconButton aria-label="Close list creation" onClick={onClose}>
            <XMarkIcon size={18} />
          </IconButton>
        </div>
        {/* The styleguide bar stepper, rather than the hand-rolled segments
            this header used to draw: it already renders "Step X of Y" and
            lays its track out from totalSteps, which is exactly what a flow
            that is sometimes four steps and sometimes five needs. */}
        <Stepper
          variant="bar"
          currentStep={currentStep}
          totalSteps={totalSteps}
          className="mt-3"
          labelClassName="text-xs"
        />
      </div>
    </div>
  )
}

export default function CreateListFlow({
  step,
  filters,
  onFiltersChange,
  onStepChange,
  onClose,
  districtHouseholds,
  savedLists,
  allContactsHouseholds,
  ring,
  turfStats,
  addressPreview,
  previewPending,
  previewFailed,
  previewStale,
  onShowAddresses,
  onHideAddresses,
  onRetryAddresses,
  drawPointCount,
  onUndoPoint,
  onClearPoints,
  onSaved,
  isElectedOfficial,
  unpreviewableKeys,
}: CreateListFlowProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(TURF_COLORS[0])
  // The three pre-draw stages the orchestrator cannot see: its `filters` step
  // is this flow's purpose → who → name phase, and which of the three is on
  // screen is nobody else's business. Survives Back from the draw step
  // because this component stays mounted for the whole flow.
  const [preDrawStage, setPreDrawStage] = useState<PreDrawStage>('purpose')
  const [purpose, setPurpose] = useState<DoorKnockingPurpose | null>(null)
  // Null means the whole contact universe, which is what makes a filtered
  // draft worth offering to save (the conditional name step).
  const [savedListId, setSavedListId] = useState<number | null>(null)
  const [savedName, setSavedName] = useState('')
  const [discardOpen, setDiscardOpen] = useState(false)

  const stage = flowStage(step, preDrawStage)

  // How narrow the audience was cut. Doubles as whether there is anything for
  // Reset to clear.
  const activeFilterCount = Object.values(filters).filter((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value),
  ).length

  // The whole reason the stepper is computed. Filters cut against the full
  // contact universe have no saved list behind them, so the flow offers to
  // make one; a candidate who started from a named list already has it. Stable
  // from the who step onward, because nothing after it can edit either input.
  const needsName = savedListId === null && activeFilterCount > 0

  // Filters step only: a drawer that pulls down to any height so the dots
  // stay visible and recolor live while pills are toggled. sheetTopPct is
  // how far down the sheet's top edge sits (0 = full screen).
  const [sheetTopPct, setSheetTopPct] = useState(0)
  const sheetRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startY: number
    startPct: number
    moved: boolean
  } | null>(null)
  useEffect(() => {
    setSheetTopPct(0)
  }, [stage])
  const handleDragStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startPct: sheetTopPct,
      moved: false,
    }
  }
  const handleDragMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    const parentHeight = sheetRef.current?.parentElement?.clientHeight
    if (!drag || !parentHeight) return
    const deltaPct = ((event.clientY - drag.startY) / parentHeight) * 100
    if (Math.abs(event.clientY - drag.startY) > 4) drag.moved = true
    setSheetTopPct(Math.min(70, Math.max(0, drag.startPct + deltaPct)))
  }
  const handleDragEnd = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag && !drag.moved) {
      // A plain click on the handle snaps between full and pulled-down.
      setSheetTopPct((current) => (current > 0 ? 0 : 55))
    }
  }
  // If the turf POST fails after the filter was created, the retry reuses
  // the existing filter instead of minting an orphan list per attempt. The
  // ref is only valid for the confirm step it was minted in — leaving the
  // step (back to filters, close) may change the audience, so it resets.
  const createdFilterIdRef = useRef<number | null>(null)
  useEffect(() => {
    if (step === 'confirm') return
    // Leaving confirm with a filter created but no turf attached (the turf
    // POST failed): delete the orphan — the next save mints a fresh one for
    // the possibly-changed audience. Best-effort; an orphaned list is a
    // nuisance, not a correctness problem.
    const orphanId = createdFilterIdRef.current
    createdFilterIdRef.current = null
    if (orphanId !== null) {
      void clientRequest('DELETE /v1/voters/voter-file/filter/:id', {
        id: String(orphanId),
      }).catch(() => undefined)
    }
  }, [step])
  // Closing the flow from confirm unmounts without a step change, so the
  // effect above never sees it — only a returned cleanup runs on unmount.
  // Both paths null the ref before deleting, so they can't double-fire.
  useEffect(
    () => () => {
      const orphanId = createdFilterIdRef.current
      createdFilterIdRef.current = null
      if (orphanId !== null) {
        void clientRequest('DELETE /v1/voters/voter-file/filter/:id', {
          id: String(orphanId),
        }).catch(() => undefined)
      }
    },
    [],
  )

  // One move through the flow, whichever vocabulary it is expressed in. A
  // stage inside the `filters` phase is this component's business alone; a
  // stage that IS a page step reports it, and the surface above turns a
  // return to `filters` into the address panel's reset.
  const goToStage = (next: CreateFlowStage) => {
    const nextStep = stageStep(next)
    if (nextStep === 'filters') setPreDrawStage(next as PreDrawStage)
    if (nextStep !== step) onStepChange(nextStep)
  }
  const back = () => {
    const previous = previousStage(stage, needsName)
    if (previous) goToStage(previous)
  }

  // Anything the candidate typed, picked or drew. A pristine flow closes
  // without a question, which is the one thing that keeps the confirm from
  // becoming noise on the X nobody meant to press twice.
  //
  // "Save and draw another" keeps the audience on purpose — the page keeps
  // `filters` across it too, because the second turf is usually the same list
  // cut somewhere else — so from that point on the purpose, the list and the
  // pills are SAVED work, not work in progress. Counting them would make the
  // X ask about a session that has nothing in it yet.
  const [savedAny, setSavedAny] = useState(false)
  const unsavedShape =
    ring !== null || drawPointCount > 0 || name.trim().length > 0
  const dirty =
    unsavedShape ||
    (!savedAny &&
      (purpose !== null ||
        savedListId !== null ||
        activeFilterCount > 0 ||
        savedName.trim().length > 0))
  const requestClose = () => {
    if (dirty) {
      setDiscardOpen(true)
      return
    }
    onClose()
  }

  // The confirm step arrives with a name already in the box, from whichever
  // of the two upstream records has one: the list the candidate just named,
  // or the purpose they picked. The suggestion is a THIRD record rather than
  // the purpose card's own copy (#1385) — a card label doubling as a default
  // title is how a copy correction renamed live campaigns.
  //
  // Two things stop it, and they are separate. **A typed box is theirs**:
  // one keystroke and no upstream rename ever overwrites it again. **A
  // suggestion is spent once applied**: the box follows the records while it
  // is untouched, so backing out to rename the list and returning brings the
  // new name — but the SAME suggestion is never re-applied, which is what
  // leaves the second turf of a "draw another" run blank. Its audience is
  // unchanged, so re-offering the name just saved is an invitation to end up
  // with two lists called the same thing; changing the goal or renaming the
  // list produces a different suggestion and offers it.
  const nameTouched = useRef(false)
  const appliedSuggestion = useRef<string | null>(null)
  useEffect(() => {
    if (step !== 'confirm' || nameTouched.current) return
    const suggestion =
      savedName.trim() ||
      (purpose ? doorKnockingPurposeNameSuggestion(purpose) : '')
    if (!suggestion || suggestion === appliedSuggestion.current) return
    appliedSuggestion.current = suggestion
    setName(suggestion)
  }, [step, savedName, purpose])

  // Stops are what the router and its 150-stop cap are denominated in; doors
  // are what the candidate walks and what the time estimate is worth. At a
  // multi-unit building one stop is many doors, so reporting stops as doors
  // understated the evening exactly where buildings are densest.
  //
  // One quantity, one number: the preview REPLACES the estimate rather than
  // sitting beside it (ADR 0010). Its counts are the ones the route will be
  // built from — the same evaluation, the same suppressions, the same
  // unit-level door — so once they exist the pack's superset is not a second
  // opinion worth printing, it is the thing that was standing in for them.
  const exactCounts = addressPreview !== null
  // Four states of one panel — waiting, failed, describing a boundary that
  // has moved, and answered — so the toggle reads the same in all of them.
  const panelOpen =
    exactCounts || previewPending || previewFailed || previewStale
  const stops = addressPreview?.stops ?? turfStats?.stops ?? 0
  const doors = addressPreview?.doors ?? turfStats?.households ?? 0
  const people = addressPreview?.people ?? turfStats?.people ?? 0

  const save = useMutation({
    mutationFn: async (drawAnother: boolean) => {
      if (!ring) throw new Error('no polygon')
      // A list picked on the who step ALREADY is a `voter-file/filter`, and
      // its id is the same one the turf attaches by — `TurfDetailsDrawer`
      // resolves a turf's list by matching them. So the turf reuses it rather
      // than filing a near-identical copy per shape cut from the same list.
      // It must never reach `createdFilterIdRef`, whose cleanup DELETES what
      // it holds: that ref means "a list this flow minted and may still have
      // to clean up", and the candidate's own saved list is neither.
      const filterId =
        savedListId ??
        createdFilterIdRef.current ??
        (
          await clientRequest('POST /v1/voters/voter-file/filter', {
            // The saved list carries the name the name step asked for; the
            // route below carries its own. Two records, two names — a route
            // renamed on the confirm step must not rename the reusable
            // audience behind it. With no name step in the path they are the
            // same string, which is the flow having only one name to give.
            name: savedName.trim() || name.trim(),
            ...transformVoterFileFiltersForBackend(filters),
          })
        ).data.id
      if (savedListId === null) createdFilterIdRef.current = filterId
      const closedRing: PolygonRing =
        ring[0]?.[0] !== ring[ring.length - 1]?.[0] ||
        ring[0]?.[1] !== ring[ring.length - 1]?.[1]
          ? [...ring, ring[0] as [number, number]]
          : ring
      await clientRequest('POST /v1/door-knocking/turfs', {
        voterFileFilterId: filterId,
        name: name.trim(),
        color,
        geoPoly: { type: 'Polygon', coordinates: [closedRing] },
      })
      createdFilterIdRef.current = null
      return drawAnother
    },
    onSuccess: (drawAnother) => {
      trackEvent(EVENTS.DoorKnocking.ListCreated, {
        stops,
        people,
        // Without shipping which filters — the demographics themselves stay
        // out of the analytics payload.
        filterCount: activeFilterCount,
        // True when they went straight into cutting the next turf, which is
        // what a candidate planning several days of walking looks like.
        drawAnother,
      })
      void queryClient.invalidateQueries({ queryKey: ['door-knocking-turfs'] })
      void queryClient.invalidateQueries({
        queryKey: ['door-knocking-saved-lists'],
      })
      setName('')
      // Both names are spent. The audience is deliberately kept across a
      // "draw another", but the voter list is NOT — this flow mints a fresh
      // `voter-file/filter` per turf — so carrying the last one's name into
      // the name step would file a second list under a name already taken,
      // from a step the candidate can walk straight past.
      setSavedName('')
      // The next turf starts from an untyped box again, so a goal or list
      // renamed after this save can still offer its name.
      nameTouched.current = false
      setSavedAny(true)
      // The page owns the post-save transition (next draw vs close).
      onSaved(drawAnother)
    },
  })

  const overCap = stops > HARD_STOP_LIMIT
  const longWalk = stops > SOFT_STOP_LIMIT && !overCap
  // Continue is the finish gesture, so while it is disabled it says what it
  // is waiting for. The three-point minimum was otherwise undiscoverable —
  // someone who placed two points had a dead button, no Done anywhere, and
  // nothing on screen naming the rule.
  const pointsNeeded = MIN_POLYGON_POINTS - drawPointCount
  let continueLabel = `Continue (${doors.toLocaleString()} doors)`
  if (pointsNeeded > 0) {
    continueLabel =
      drawPointCount === 0
        ? `Tap ${MIN_POLYGON_POINTS} points to continue`
        : `${pointsNeeded} more point${pointsNeeded === 1 ? '' : 's'} to continue`
  } else if (stops === 0) {
    continueLabel = 'No doors in this area'
  }

  const unpreviewableLabels = unpreviewableDisclosureLabels(unpreviewableKeys)

  const discardDialog = (
    <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard this list?</AlertDialogTitle>
          <AlertDialogDescription>
            Your filters and the boundary you drew will be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setDiscardOpen(false)
              onClose()
            }}
          >
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  // The draw step frames the live map: chrome on top and bottom, the map
  // itself (rendered by the page underneath) does the work in between. This
  // is why the flow is not built on OutreachFlowShell — a Vaul drawer would
  // sit over the canvas and swallow every tap meant to place a vertex.
  if (stage === 'draw') {
    return (
      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col">
        <div className="pointer-events-auto">
          <StepHeader
            stage={stage}
            needsName={needsName}
            onBack={back}
            onClose={requestClose}
          />
        </div>
        <div className="flex-1" />
        {/* Bottom-right of the live map band, in flow directly above the
            stats bar (and in its column, so they line up over Continue) —
            a taller bar from a cap warning pushes them up instead of
            covering them. Only the buttons take pointer events; the rest of
            the row stays a tappable part of the map. */}
        <div className="px-4 pb-3 sm:px-6">
          <div className="mx-auto flex w-full max-w-2xl justify-end">
            <div className="pointer-events-auto flex items-center gap-2">
              {drawPointCount > 0 && (
                <Button
                  size="small"
                  variant="secondary"
                  className="shadow-md"
                  aria-label="Undo last boundary point"
                  onClick={onUndoPoint}
                >
                  Undo
                </Button>
              )}
              <Button
                size="small"
                variant="secondary"
                className="shadow-md"
                aria-label="Clear the boundary"
                disabled={drawPointCount === 0}
                onClick={onClearPoints}
              >
                Clear
              </Button>
            </div>
          </div>
        </div>
        <div className="pointer-events-auto border-t border-border bg-background px-4 py-4 sm:px-6">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
            {/* Stacked on a phone: side by side, the stats wrap to four lines in
              a sliver of a column while the button squeezes to nothing. */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              {/* Everything here describes the drawn shape, not the district —
                these numbers are what the candidate commits to. */}
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-semibold tabular-nums">
                    {doors.toLocaleString()}
                  </span>{' '}
                  doors ·{' '}
                  <span className="font-semibold tabular-nums">
                    {stops.toLocaleString()}
                  </span>{' '}
                  stops ·{' '}
                  <span className="font-semibold tabular-nums">
                    {people.toLocaleString()}
                  </span>{' '}
                  people
                </p>
                {doors > 0 && (
                  <p className="text-xs text-muted-foreground">
                    About {estimateWalkTime(doors)} of knocking, at{' '}
                    {DOORS_PER_HOUR} doors an hour
                  </p>
                )}
                {/* Both of these hedge the pack, so both go when the pack is
                  no longer what is on screen: the disclosure explains a
                  shortfall the exact counts don't have, and the party mix is
                  a breakdown of the superset's people that would no longer
                  add up to the people figure above it. */}
                {!exactCounts && unpreviewableLabels.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    The map can&rsquo;t shade by{' '}
                    {unpreviewableLabels.join(', ')} yet, so these counts
                    include people that filter will exclude. Your saved list
                    still applies it when you knock.
                  </p>
                )}
                {!exactCounts && (turfStats?.partyMix.length ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {turfStats?.partyMix
                      .map(
                        (slice) =>
                          `${slice.people.toLocaleString()} ${slice.label}`,
                      )
                      .join(' · ')}
                  </p>
                )}
                {overCap && (
                  <p className="text-sm text-destructive">
                    Over the {HARD_STOP_LIMIT}-stop limit — draw a smaller area.
                  </p>
                )}
                {longWalk && (
                  <p className="text-sm text-warning">
                    Over {SOFT_STOP_LIMIT} stops is a long evening. You can
                    still save it, or draw a smaller area.
                  </p>
                )}
                {doors > 0 && (
                  <Button
                    size="small"
                    variant="ghost"
                    className="-ml-3 mt-1"
                    aria-expanded={panelOpen}
                    aria-controls="draw-step-doors"
                    onClick={panelOpen ? onHideAddresses : onShowAddresses}
                  >
                    {panelOpen ? 'Hide the addresses' : 'See the addresses'}
                  </Button>
                )}
              </div>
              <Button
                disabled={!ring || stops === 0 || overCap}
                onClick={() => goToStage('confirm')}
              >
                {continueLabel}
              </Button>
            </div>
            {/* Capped in height rather than allowed to grow: the step is a map
              being drawn on, and a list that eats the viewport takes away the
              thing the candidate is checking it against. */}
            {panelOpen && (
              <div
                id="draw-step-doors"
                className="max-h-[40dvh] overflow-y-auto rounded-lg border border-border p-3"
              >
                <p className="text-sm font-semibold">
                  The doors inside your boundary
                </p>
                {previewPending && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Looking up the addresses…
                  </p>
                )}
                {previewFailed && (
                  <>
                    <p className="mt-2 text-sm text-destructive">
                      Couldn&rsquo;t load the addresses.
                    </p>
                    <Button
                      size="small"
                      variant="secondary"
                      className="mt-2"
                      onClick={onRetryAddresses}
                    >
                      Try again
                    </Button>
                  </>
                )}
                {/* The list is of one boundary, and that boundary moved. It is
                  not narrowed or widened to fit the new one — showing it under
                  a shape it doesn't describe is the failure this panel exists
                  to avoid — so it is withdrawn until it is asked for again. */}
                {previewStale && (
                  <>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Your boundary changed, so these addresses are for the
                      shape you drew before.
                    </p>
                    <Button
                      size="small"
                      variant="secondary"
                      className="mt-2"
                      onClick={onShowAddresses}
                    >
                      Show the addresses here
                    </Button>
                  </>
                )}
                {addressPreview && (
                  <>
                    {/* No hedge on these counts, because there is nothing left
                      to hedge: this is the evaluation the route is built from,
                      with do-not-knock and "not a voter" residents already
                      out. What it does need to say is that it is a snapshot,
                      since a list saved tomorrow is evaluated again. */}
                    <p className="text-xs text-muted-foreground">
                      Everyone your filters target, as of now — people marked
                      do-not-knock or &ldquo;not a voter&rdquo; are already out.
                    </p>
                    {/* No numbering: nothing has decided a visiting order yet,
                      and the Aug 14 walkthrough asked numerals out of the list
                      view. */}
                    <ul className="mt-2 divide-y divide-border">
                      {addressPreview.locations.map((location, index) => (
                        <li key={index} className="py-2">
                          {location.doors.length > 1 && (
                            <p className="text-xs font-medium">
                              {location.doors.length} doors at one location
                            </p>
                          )}
                          <ul>
                            {location.doors.map((door, doorIndex) => (
                              <li key={doorIndex} className="text-sm">
                                {door.address}
                                <span className="text-muted-foreground">
                                  {' '}
                                  · {door.people.toLocaleString()}{' '}
                                  {door.people === 1 ? 'voter' : 'voters'}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                    {/* The cap is on stops, so it is stops the shortfall is
                      counted in — the same unit the 150 limit above is. */}
                    {addressPreview.locations.length < addressPreview.stops && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Showing the first{' '}
                        {addressPreview.locations.length.toLocaleString()} of{' '}
                        {addressPreview.stops.toLocaleString()} stops.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        {discardDialog}
      </div>
    )
  }

  // The who step is the one that peeks: its pills recolor the dots underneath
  // live, so the map is worth uncovering. Purpose is a card list and name is a
  // text field — pulling either down reveals a map nothing on screen changes.
  const peekable = stage === 'who'
  const pulled = peekable && sheetTopPct > 0
  return (
    <div
      ref={sheetRef}
      className={`absolute inset-x-0 bottom-0 z-20 flex flex-col bg-background ${
        pulled ? 'rounded-t-xl border-t border-border shadow-lg' : ''
      }`}
      style={{ top: peekable ? `${sheetTopPct}%` : 0 }}
    >
      {peekable && (
        <button
          type="button"
          aria-label={
            pulled ? 'Expand the filters' : 'Pull down to see the map'
          }
          className="flex w-full touch-none items-center justify-center py-2"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          <span className="h-1.5 w-12 rounded-full bg-muted" />
        </button>
      )}
      <StepHeader
        stage={stage}
        needsName={needsName}
        onBack={previousStage(stage, needsName) ? back : null}
        onClose={requestClose}
      />
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          {stage === 'purpose' && (
            <PurposeStep
              selected={purpose}
              onSelect={(next) => {
                setPurpose(next)
                goToStage('who')
              }}
            />
          )}

          {stage === 'who' && (
            <WhoStep
              filters={filters}
              onFiltersChange={(next) => {
                // Editing a pill is leaving the named list behind: the draft
                // is no longer that list, so the offer to save it as a new one
                // comes back and the stepper grows the fifth step with it.
                setSavedListId(null)
                onFiltersChange(next)
              }}
              savedLists={savedLists}
              allContactsHouseholds={allContactsHouseholds}
              selectedListId={savedListId}
              onSelectList={(listId) => {
                setSavedListId(listId)
                onFiltersChange(
                  listId === null
                    ? {}
                    : (savedLists.find((list) => list.id === listId)?.filters ??
                        {}),
                )
              }}
              isElectedOfficial={isElectedOfficial}
            />
          )}

          {stage === 'name' && (
            <NameStep
              value={savedName}
              onChange={setSavedName}
              districtHouseholds={districtHouseholds}
            />
          )}

          {stage === 'confirm' && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="turf-name"
                  className="text-xs font-semibold uppercase tracking-wide"
                >
                  Route name
                </Label>
                <Input
                  id="turf-name"
                  value={name}
                  maxLength={MAX_TURF_NAME_LENGTH}
                  placeholder="Name this list"
                  onChange={(e) => {
                    nameTouched.current = true
                    setName(e.target.value)
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide">
                  List color
                </Label>
                <div className="flex gap-2.5">
                  {TURF_COLORS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-label={`Turf color ${option}`}
                      aria-pressed={color === option}
                      className={`h-8 w-8 rounded-full border-2 ${
                        color === option
                          ? 'border-foreground'
                          : 'border-transparent'
                      }`}
                      style={{ backgroundColor: option }}
                      onClick={() => setColor(option)}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-baseline justify-between border-t border-border pt-4">
                <span className="text-sm font-semibold">This list</span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {doors.toLocaleString()} doors · {stops.toLocaleString()}{' '}
                  stops · {people.toLocaleString()} voters
                </span>
              </div>
              {save.isError && (
                <p className="text-sm text-destructive">
                  Saving failed — check the shape and try again.
                </p>
              )}
            </>
          )}
        </div>
      </div>
      {/* The purpose step has no footer: choosing a card is the advance, so a
          CTA under it would be a second way to do the same thing, disabled
          until the first one was used. */}
      {stage !== 'purpose' && (
        <div className="border-t border-border bg-background px-4 py-4 sm:px-6">
          <div className="mx-auto flex w-full max-w-2xl flex-wrap justify-center gap-3">
            {stage === 'who' && (
              <>
                {/* No polygon exists yet, so district-wide is the only honest
                    denominator here — and with the count now inside the CTA,
                    this line is what still says which denominator it is. */}
                <p className="flex-1 self-center text-sm text-muted-foreground">
                  Across your whole district. You&rsquo;ll draw the area to
                  knock next.
                </p>
                <Button
                  variant="ghost"
                  disabled={activeFilterCount === 0}
                  onClick={() => {
                    setSavedListId(null)
                    onFiltersChange({})
                  }}
                >
                  Reset filters
                </Button>
                <Button
                  className="w-full max-w-xs"
                  disabled={districtHouseholds === 0}
                  onClick={() => goToStage(needsName ? 'name' : 'draw')}
                >
                  {districtHouseholds === 0
                    ? 'No matching households'
                    : `Continue (${districtHouseholds.toLocaleString()} households)`}
                </Button>
              </>
            )}
            {stage === 'name' && (
              <Button
                className="w-full max-w-xs"
                disabled={savedName.trim().length === 0}
                onClick={() => goToStage('draw')}
              >
                Continue
              </Button>
            )}
            {stage === 'confirm' && (
              <>
                <Button
                  className="flex-1"
                  disabled={name.trim().length === 0 || save.isPending}
                  onClick={() => save.mutate(false)}
                >
                  {save.isPending ? 'Saving…' : 'Save and exit'}
                </Button>
                <Button
                  variant="secondary"
                  className="flex-1"
                  disabled={name.trim().length === 0 || save.isPending}
                  onClick={() => save.mutate(true)}
                >
                  Save and draw another
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      {discardDialog}
    </div>
  )
}

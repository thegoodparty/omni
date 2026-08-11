'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  IconButton,
  Input,
  Label,
  ToggleGroup,
  ToggleGroupItem,
  XMarkIcon,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import filterSections from 'app/dashboard/contacts/[[...attr]]/components/configs/filters.config'
import {
  transformVoterFileFiltersForBackend,
  type VoterFileFilters,
} from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import { TURF_COLORS } from '../turfQueries'
import type { PolygonRing } from '../VoterMapCanvas'
import type { PolygonStats } from '../filterEngine'

// The demo's pill look (same selected-state convention as the CRM wizard's
// PILL_TOGGLE_ITEM_CLASSNAME).
const PILL_CLASSNAME =
  'rounded-full border border-components-input-border bg-transparent px-3.5 py-1.5 text-sm font-normal text-foreground data-[state=on]:border-tertiary-dark data-[state=on]:bg-tertiary-dark data-[state=on]:text-tertiary-foreground data-[state=on]:hover:bg-tertiary-dark/90'

// Contacts made resolves to an id-set override rather than a column
// predicate, and voterDoorKnocking.evaluate doesn't pass overrides — a
// selection here would be recorded on the filter but silently ignored when
// the route freezes. It also counts contact_interaction_door_knock rows, so
// knocking moves the value it filters on. Excluded until evaluate carries
// the overrides.
const CONTACTS_MADE_FIELD_KEY = 'contacts_made'

export type CreateFlowStep = 'filters' | 'draw' | 'confirm'

interface CreateListFlowProps {
  step: CreateFlowStep
  filters: VoterFileFilters
  onFiltersChange: (filters: VoterFileFilters) => void
  onStepChange: (step: CreateFlowStep) => void
  onClose: () => void
  // Live numbers for the draw step, computed by the page from the pack.
  matchingHouseholds: number
  ring: PolygonRing | null
  turfStats: PolygonStats | null
  // Saved-flow completion: clear the drawing (and optionally exit).
  onSaved: (drawAnother: boolean) => void
}

const STEP_META: Record<CreateFlowStep, { title: string; caption: string }> = {
  filters: {
    title: 'Filter voters',
    caption: 'Refine who to reach, then draw your route on the map.',
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

const STEP_ORDER: CreateFlowStep[] = ['filters', 'draw', 'confirm']

const StepHeader = ({
  step,
  onBack,
  onClose,
}: {
  step: CreateFlowStep
  onBack: (() => void) | null
  onClose: () => void
}) => {
  const stepIndex = STEP_ORDER.indexOf(step)
  const meta = STEP_META[step]
  return (
    <div className="border-b border-border bg-background px-6 py-4">
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
        <div className="mt-3 flex items-center gap-2">
          {STEP_ORDER.map((name, index) => (
            <span
              key={name}
              className={`h-1 flex-1 rounded-full ${
                index <= stepIndex ? 'bg-info' : 'bg-muted'
              }`}
            />
          ))}
          <span className="shrink-0 text-xs text-muted-foreground">
            Step {stepIndex + 1} of 3
          </span>
        </div>
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
  matchingHouseholds,
  ring,
  turfStats,
  onSaved,
}: CreateListFlowProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(TURF_COLORS[0])
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
  }, [step])
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

  const save = useMutation({
    mutationFn: async (drawAnother: boolean) => {
      if (!ring) throw new Error('no polygon')
      const filterId =
        createdFilterIdRef.current ??
        (
          await clientRequest('POST /v1/voters/voter-file/filter', {
            name: name.trim(),
            ...transformVoterFileFiltersForBackend(filters),
          })
        ).data.id
      createdFilterIdRef.current = filterId
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
        stops: turfStats?.stops ?? 0,
        people: turfStats?.people ?? 0,
        // How narrow the audience was cut, without shipping which filters —
        // the demographics themselves stay out of the analytics payload.
        filterCount: Object.values(filters).filter((value) =>
          Array.isArray(value) ? value.length > 0 : Boolean(value),
        ).length,
        // True when they went straight into cutting the next turf, which is
        // what a candidate planning several days of walking looks like.
        drawAnother,
      })
      void queryClient.invalidateQueries({ queryKey: ['door-knocking-turfs'] })
      void queryClient.invalidateQueries({
        queryKey: ['door-knocking-saved-lists'],
      })
      setName('')
      // The page owns the post-save transition (next draw vs close).
      onSaved(drawAnother)
    },
  })

  const overCap = (turfStats?.stops ?? 0) > 150

  const toggleGroupValues = (
    options: Array<{ key: string; label: string }>,
  ): string[] =>
    options.filter((option) => filters[option.key]).map((option) => option.key)

  const setGroupValues = (
    options: Array<{ key: string; label: string }>,
    values: string[],
  ) => {
    const selected = new Set(values)
    const next = { ...filters }
    options.forEach((option) => {
      next[option.key] = selected.has(option.key)
    })
    onFiltersChange(next)
  }

  // The draw step frames the live map: chrome on top and bottom, the map
  // itself (rendered by the page underneath) does the work in between.
  if (step === 'draw') {
    return (
      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col">
        <div className="pointer-events-auto">
          <StepHeader
            step={step}
            onBack={() => onStepChange('filters')}
            onClose={onClose}
          />
        </div>
        <div className="flex-1" />
        <div className="pointer-events-auto border-t border-border bg-background px-6 py-4">
          <div className="mx-auto flex w-full max-w-2xl items-center gap-4">
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-semibold tabular-nums">
                {matchingHouseholds.toLocaleString()}
              </span>{' '}
              matching households ·{' '}
              <span className="font-semibold tabular-nums">
                {(turfStats?.stops ?? 0).toLocaleString()}
              </span>{' '}
              selected doors
              {overCap && (
                <span className="block text-destructive">
                  Over the 150-stop limit — draw a smaller area.
                </span>
              )}
            </p>
            <Button
              disabled={!ring || (turfStats?.stops ?? 0) === 0 || overCap}
              onClick={() => onStepChange('confirm')}
            >
              Continue ({(turfStats?.stops ?? 0).toLocaleString()} doors)
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const peekable = step === 'filters'
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
        step={step}
        onBack={step === 'confirm' ? () => onStepChange('draw') : null}
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          {step === 'filters' &&
            filterSections.map((section) =>
              section.fields
                .filter((field) => field.key !== CONTACTS_MADE_FIELD_KEY)
                .map((field) => (
                  <div key={field.key} className="flex flex-col gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
                      {field.label}
                    </span>
                    <ToggleGroup
                      type="multiple"
                      value={toggleGroupValues(field.options)}
                      onValueChange={(values) =>
                        setGroupValues(field.options, values)
                      }
                      aria-label={field.label}
                      className="flex flex-wrap justify-start gap-2"
                    >
                      {field.options.map((option) => (
                        <ToggleGroupItem
                          key={option.key}
                          value={option.key}
                          className={PILL_CLASSNAME}
                        >
                          {option.label}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                )),
            )}

          {step === 'confirm' && (
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
                  maxLength={120}
                  placeholder="Name this list"
                  onChange={(e) => setName(e.target.value)}
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
                <span className="text-sm font-semibold">Stops</span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {(turfStats?.stops ?? 0).toLocaleString()} doors ·{' '}
                  {(turfStats?.people ?? 0).toLocaleString()} voters
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
      <div className="border-t border-border bg-background px-6 py-4">
        <div className="mx-auto flex w-full max-w-2xl justify-center gap-3">
          {step === 'filters' && (
            <>
              <p className="flex-1 self-center text-sm text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground">
                  {matchingHouseholds.toLocaleString()}
                </span>{' '}
                matching households
              </p>
              <Button
                className="w-full max-w-xs"
                onClick={() => onStepChange('draw')}
              >
                Continue
              </Button>
            </>
          )}
          {step === 'confirm' && (
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
    </div>
  )
}

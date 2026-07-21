'use client'

import { useState } from 'react'
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
import filterSections from 'app/dashboard/contacts/[[...attr]]/components/configs/filters.config'
import {
  transformVoterFileFiltersForBackend,
  type VoterFileFilters,
} from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import { TURF_COLORS } from '../turfQueries'
import type { PolygonRing } from '../VoterMapCanvas'
import type { PolygonStats } from '../filterEngine'

// The demo's pill look, compacted for the flow panel (same selected-state
// convention as the CRM wizard's PILL_TOGGLE_ITEM_CLASSNAME).
const PILL_CLASSNAME =
  'rounded-full border border-components-input-border bg-transparent px-3 py-1.5 text-xs font-normal text-foreground data-[state=on]:border-tertiary-dark data-[state=on]:bg-tertiary-dark data-[state=on]:text-tertiary-foreground data-[state=on]:hover:bg-tertiary-dark/90'

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
    caption: 'Refine who to reach, then draw your turf on the map.',
  },
  draw: {
    title: 'Draw your door knocking boundaries',
    caption: 'Outline map areas to build targeted door lists.',
  },
  confirm: {
    title: 'Confirm your list',
    caption: 'Review the turf, give it a name and color, then save it.',
  },
}

const STEP_ORDER: CreateFlowStep[] = ['filters', 'draw', 'confirm']

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

  const save = useMutation({
    mutationFn: async (drawAnother: boolean) => {
      if (!ring) throw new Error('no polygon')
      const filterRes = await clientRequest(
        'POST /v1/voters/voter-file/filter',
        {
          name: name.trim(),
          ...transformVoterFileFiltersForBackend(filters),
        },
      )
      const closedRing: PolygonRing =
        ring[0]?.[0] !== ring[ring.length - 1]?.[0] ||
        ring[0]?.[1] !== ring[ring.length - 1]?.[1]
          ? [...ring, ring[0] as [number, number]]
          : ring
      await clientRequest('POST /v1/door-knocking/turfs', {
        voterFileFilterId: filterRes.data.id,
        name: name.trim(),
        color,
        geoPoly: { type: 'Polygon', coordinates: [closedRing] },
      })
      return drawAnother
    },
    onSuccess: (drawAnother) => {
      void queryClient.invalidateQueries({ queryKey: ['door-knocking-turfs'] })
      void queryClient.invalidateQueries({
        queryKey: ['door-knocking-saved-lists'],
      })
      setName('')
      // The page owns the post-save transition (next draw vs close).
      onSaved(drawAnother)
    },
  })

  const stepIndex = STEP_ORDER.indexOf(step)
  const meta = STEP_META[step]
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

  return (
    <div className="flex h-full w-96 shrink-0 flex-col border-l border-border bg-background">
      <div className="flex items-start gap-2 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{meta.title}</h2>
          <p className="text-sm text-muted-foreground">{meta.caption}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Step {stepIndex + 1} of 3
          </p>
        </div>
        {stepIndex > 0 && (
          <Button
            size="small"
            variant="ghost"
            onClick={() => onStepChange(STEP_ORDER[stepIndex - 1] ?? 'filters')}
          >
            Back
          </Button>
        )}
        <IconButton aria-label="Close list creation" onClick={onClose}>
          <XMarkIcon size={16} />
        </IconButton>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {step === 'filters' && (
          <div className="flex flex-col gap-5">
            {filterSections.map((section) =>
              section.fields.map((field) => (
                <div key={field.key} className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-foreground">
                    {field.label}
                  </span>
                  <ToggleGroup
                    type="multiple"
                    value={toggleGroupValues(field.options)}
                    onValueChange={(values) =>
                      setGroupValues(field.options, values)
                    }
                    aria-label={field.label}
                    className="flex flex-wrap justify-start gap-1.5"
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
          </div>
        )}

        {step === 'draw' && (
          <div className="flex flex-col gap-4">
            <div className="rounded-md border border-border p-3 text-sm">
              <span className="font-semibold tabular-nums">
                {matchingHouseholds.toLocaleString()}
              </span>{' '}
              matching households ·{' '}
              <span className="font-semibold tabular-nums">
                {(turfStats?.stops ?? 0).toLocaleString()}
              </span>{' '}
              selected doors
            </div>
            <p className="text-sm text-muted-foreground">
              Click the map to drop boundary points around the doors you want to
              knock. Double-click to close the shape.
            </p>
            {overCap && (
              <p className="text-sm text-destructive">
                Over the 150-stop limit — draw a smaller area.
              </p>
            )}
          </div>
        )}

        {step === 'confirm' && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="turf-name">Turf name</Label>
              <Input
                id="turf-name"
                value={name}
                maxLength={120}
                placeholder="Name this list"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>List color</Label>
              <div className="flex gap-2">
                {TURF_COLORS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-label={`Turf color ${option}`}
                    aria-pressed={color === option}
                    className={`h-7 w-7 rounded-full border-2 ${
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
            <div className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
              <span className="font-semibold">Stops</span>
              <span className="tabular-nums">
                {(turfStats?.stops ?? 0).toLocaleString()} doors ·{' '}
                {(turfStats?.people ?? 0).toLocaleString()} voters
              </span>
            </div>
            {save.isError && (
              <p className="text-sm text-destructive">
                Saving failed — check the shape and try again.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-border p-4">
        {step === 'filters' && (
          <Button className="w-full" onClick={() => onStepChange('draw')}>
            Continue
          </Button>
        )}
        {step === 'draw' && (
          <Button
            className="w-full"
            disabled={!ring || (turfStats?.stops ?? 0) === 0 || overCap}
            onClick={() => onStepChange('confirm')}
          >
            Continue ({(turfStats?.stops ?? 0).toLocaleString()} doors)
          </Button>
        )}
        {step === 'confirm' && (
          <>
            <Button
              variant="outline"
              className="flex-1"
              disabled={name.trim().length === 0 || save.isPending}
              onClick={() => save.mutate(true)}
            >
              Save and draw another
            </Button>
            <Button
              className="flex-1"
              disabled={name.trim().length === 0 || save.isPending}
              onClick={() => save.mutate(false)}
            >
              {save.isPending ? 'Saving…' : 'Save and exit'}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Checkbox,
} from '@styleguide'
import { LoadingAnimation } from 'app/shared/utils/LoadingAnimation'
import DashboardLayout from 'app/dashboard/shared/DashboardLayout'
import { Campaign } from 'helpers/types'
import { voterPackQueryOptions } from './useVoterPack'
import { DimSelections, polygonStats, runFilter } from './filterEngine'
import { turfsQueryOptions } from './turfQueries'
import SaveTurfDialog from './SaveTurfDialog'
import TurfList from './TurfList'
import type { PolygonRing } from './VoterMapCanvas'

const VoterMapCanvas = dynamic(() => import('./VoterMapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <LoadingAnimation />
    </div>
  ),
})

// Dim keys the panel exposes in v1, in display order — the rest of the
// manifest's dims still filter-match, they just don't get panel UI yet.
const PANEL_DIMS: Array<[string, string]> = [
  ['canvassStatus', 'Knock status'],
  ['party', 'Political party'],
  ['age', 'Age'],
  ['gender', 'Gender'],
  ['voterStatus', 'Voter status'],
  ['hasCellPhone', 'Has cell phone'],
  ['homeowner', 'Homeowner'],
  ['veteranStatus', 'Veteran'],
]

const VALUE_LABELS: Record<string, string> = {
  unknown: 'Unknown',
  not_home: 'Not home',
  supporter: 'Supporter',
  non_supporter: 'Non-supporter',
  inaccessible: 'Inaccessible',
  refused: 'Refused',
  not_a_voter: 'Not a voter',
  '18_25': '18-25',
  '25_35': '25-35',
  '35_50': '35-50',
  '50_plus': '50+',
  M: 'Male',
  F: 'Female',
}

interface NativeDoorKnockingPageProps {
  pathname: string
  campaign: Campaign | null
}

export default function NativeDoorKnockingPage({
  pathname,
  campaign,
}: NativeDoorKnockingPageProps) {
  const packQuery = useQuery(voterPackQueryOptions)
  const turfsQuery = useQuery(turfsQueryOptions)
  const [selections, setSelections] = useState<DimSelections>(new Map())
  const [ring, setRing] = useState<PolygonRing | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [focusTurf, setFocusTurf] = useState<DoorKnockingTurf | null>(null)
  const [clearDrawToken, setClearDrawToken] = useState(0)

  const filterResult = useMemo(
    () => (packQuery.data ? runFilter(packQuery.data, selections) : null),
    [packQuery.data, selections],
  )
  const turfStats = useMemo(
    () =>
      packQuery.data && filterResult && ring
        ? polygonStats(packQuery.data, filterResult.matchedPerDot, ring)
        : null,
    [packQuery.data, filterResult, ring],
  )

  const toggleValue = (dimKey: string, valueIndex: number, total: number) => {
    setSelections((current) => {
      const next = new Map(current)
      const existing =
        next.get(dimKey) ?? new Set(Array.from({ length: total }, (_, i) => i))
      const updated = new Set(existing)
      if (updated.has(valueIndex)) {
        updated.delete(valueIndex)
      } else {
        updated.add(valueIndex)
      }
      next.set(dimKey, updated)
      return next
    })
  }

  return (
    <DashboardLayout
      pathname={pathname}
      campaign={campaign}
      wrapperClassName="!p-0 flex flex-col"
    >
      <div className="flex h-[calc(100dvh-4rem)] w-full">
        <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-background p-4">
          <h1 className="text-lg font-semibold">Door knocking</h1>
          {packQuery.isPending && (
            <p className="text-sm text-muted-foreground">
              Loading your voter map…
            </p>
          )}
          {packQuery.isError && (
            <p className="text-sm text-destructive">
              The voter map could not load. Refresh to try again.
            </p>
          )}
          {packQuery.data && filterResult && (
            <>
              <div className="rounded-md border border-border p-3 text-sm">
                <div>
                  <span className="font-semibold tabular-nums">
                    {filterResult.people.toLocaleString()}
                  </span>{' '}
                  matching voters
                </div>
                <div>
                  <span className="font-semibold tabular-nums">
                    {filterResult.households.toLocaleString()}
                  </span>{' '}
                  households ·{' '}
                  <span className="font-semibold tabular-nums">
                    {filterResult.dots.toLocaleString()}
                  </span>{' '}
                  doors
                </div>
              </div>
              {turfStats && (
                <div className="rounded-md border border-info bg-info-light p-3 text-sm">
                  <div className="font-semibold">Drawn area</div>
                  <div>
                    <span className="font-semibold tabular-nums">
                      {turfStats.stops.toLocaleString()}
                    </span>{' '}
                    stops ·{' '}
                    <span className="font-semibold tabular-nums">
                      {turfStats.people.toLocaleString()}
                    </span>{' '}
                    voters
                  </div>
                  {turfStats.stops > 150 && (
                    <p className="mt-1 text-destructive">
                      Over the 150-stop limit — draw a smaller area.
                    </p>
                  )}
                  <Button
                    size="small"
                    className="mt-2 w-full"
                    disabled={turfStats.stops === 0 || turfStats.stops > 150}
                    onClick={() => setSaveOpen(true)}
                  >
                    Save turf
                  </Button>
                </div>
              )}
              <TurfList onFocusTurf={setFocusTurf} />
              <Accordion type="multiple" className="w-full">
                {PANEL_DIMS.map(([key, label]) => {
                  const dim = packQuery.data.manifest.dims.find(
                    (d) => d.key === key,
                  )
                  if (!dim) return null
                  const selected =
                    selections.get(key) ?? new Set(dim.values.map((_, i) => i))
                  return (
                    <AccordionItem key={key} value={key}>
                      <AccordionTrigger className="text-sm">
                        {label}
                      </AccordionTrigger>
                      <AccordionContent className="flex flex-col gap-2">
                        {dim.values.map((value, index) => (
                          <label
                            key={value}
                            className="flex items-center gap-2 text-sm"
                          >
                            <Checkbox
                              checked={selected.has(index)}
                              onCheckedChange={() =>
                                toggleValue(key, index, dim.values.length)
                              }
                            />
                            {VALUE_LABELS[value] ?? value}
                          </label>
                        ))}
                      </AccordionContent>
                    </AccordionItem>
                  )
                })}
              </Accordion>
            </>
          )}
        </aside>
        <div className="min-w-0 flex-1">
          {packQuery.data && filterResult && (
            <VoterMapCanvas
              pack={packQuery.data}
              filterResult={filterResult}
              turfs={turfsQuery.data ?? []}
              focusTurf={focusTurf}
              clearDrawToken={clearDrawToken}
              onPolygonChange={setRing}
            />
          )}
        </div>
      </div>
      {ring && (
        <SaveTurfDialog
          ring={ring}
          open={saveOpen}
          onOpenChange={setSaveOpen}
          onSaved={() => setClearDrawToken((token) => token + 1)}
        />
      )}
    </DashboardLayout>
  )
}

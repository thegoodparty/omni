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
import KnockTurfDialog from './KnockTurfDialog'
import SaveTurfDialog from './SaveTurfDialog'
import TurfList from './TurfList'
import WalkView from './WalkView'
import type { PolygonRing } from './VoterMapCanvas'
import { useDistrictResolution } from 'app/dashboard/shared/useDistrictResolution'

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
  // The pack and every turf read resolve a district server-side
  // (resolveEligibleDistrictId), so without one they can only 400 — and a turf
  // cannot be drawn against a district we can't identify.
  const { isUnresolvable } = useDistrictResolution()
  const packQuery = useQuery({
    ...voterPackQueryOptions,
    enabled: !isUnresolvable,
  })
  const turfsQuery = useQuery({
    ...turfsQueryOptions,
    enabled: !isUnresolvable,
  })
  const [selections, setSelections] = useState<DimSelections>(new Map())
  const [ring, setRing] = useState<PolygonRing | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [focusTurf, setFocusTurf] = useState<DoorKnockingTurf | null>(null)
  const [startDrawToken, setStartDrawToken] = useState(0)
  const [clearDrawToken, setClearDrawToken] = useState(0)
  const [knockTurf, setKnockTurf] = useState<DoorKnockingTurf | null>(null)
  const [walkTurf, setWalkTurf] = useState<{
    id: number
    name: string
  } | null>(null)

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
          {/* Before the isPending branch: a district-gated query is neither
              pending-with-a-request nor errored, so that branch would otherwise
              claim to be loading forever. */}
          {isUnresolvable && (
            <p className="text-sm text-muted-foreground">
              Voter data is not available for this office yet, so there is no
              map to draw turfs on. Contact support at help@goodparty.org and
              our team can set this up for you.
            </p>
          )}
          {!isUnresolvable && packQuery.isPending && (
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
              <Button
                size="small"
                variant={ring ? 'outline' : 'default'}
                onClick={() => {
                  setWalkTurf(null)
                  setStartDrawToken((token) => token + 1)
                }}
              >
                {ring ? 'Redraw turf' : 'Draw a turf'}
              </Button>
              {!ring && (
                <p className="text-xs text-muted-foreground">
                  Click the map to outline an area; double-click to finish.
                </p>
              )}
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
              <TurfList
                walkingTurfId={walkTurf?.id}
                onFocusTurf={(turf) => {
                  setWalkTurf(null)
                  setFocusTurf(turf)
                }}
                onKnockTurf={setKnockTurf}
                onOpenRoute={(turf) =>
                  setWalkTurf({ id: turf.id, name: turf.name })
                }
              />
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
          {walkTurf ? (
            <WalkView
              turfId={walkTurf.id}
              turfName={walkTurf.name}
              onBack={() => setWalkTurf(null)}
            />
          ) : (
            packQuery.data &&
            filterResult && (
              <VoterMapCanvas
                pack={packQuery.data}
                filterResult={filterResult}
                turfs={turfsQuery.data ?? []}
                focusTurf={focusTurf}
                startDrawToken={startDrawToken}
                clearDrawToken={clearDrawToken}
                onPolygonChange={setRing}
              />
            )
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
      {knockTurf && (
        <KnockTurfDialog
          key={knockTurf.id}
          turf={knockTurf}
          open={true}
          onOpenChange={(open) => {
            if (!open) setKnockTurf(null)
          }}
          onRouteReady={(turfId) => {
            setKnockTurf(null)
            setWalkTurf({ id: turfId, name: knockTurf.name })
          }}
        />
      )}
    </DashboardLayout>
  )
}

'use client'

import { useQuery } from '@tanstack/react-query'
import { DoorKnockingTurf } from '@goodparty_org/contracts'
import { IconButton, XMarkIcon } from '@styleguide'
import filterSections from 'app/dashboard/contacts/[[...attr]]/components/configs/filters.config'
import { routeQueryOptions, savedListsQueryOptions } from './turfQueries'
import type { PolygonStats } from './filterEngine'

// option key -> pill label, straight from the sections config the create
// flow renders, so Details always speaks the same vocabulary.
const OPTION_LABELS: Record<string, string> = Object.fromEntries(
  filterSections.flatMap((section) =>
    section.fields.flatMap((field) =>
      field.options.map((option) => [option.key, option.label]),
    ),
  ),
)

const formatDuration = (seconds: number): string => {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-lg border border-border p-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-sm font-semibold">{value}</p>
  </div>
)

interface TurfDetailsSheetProps {
  turf: DoorKnockingTurf
  // Doors/voters inside the turf polygon, computed by the page from the
  // full (unfiltered) pack.
  areaStats: PolygonStats | null
  onClose: () => void
}

export default function TurfDetailsSheet({
  turf,
  areaStats,
  onClose,
}: TurfDetailsSheetProps) {
  const routeQuery = useQuery({
    ...routeQueryOptions(turf.id),
    enabled: turf.locked,
  })
  const listsQuery = useQuery(savedListsQueryOptions)
  const filter = listsQuery.data?.find(
    (list) => list.id === turf.voterFileFilterId,
  )
  const appliedFilterLabels = filter
    ? Object.entries(OPTION_LABELS)
        .filter(([key]) => filter[key] === true)
        .map(([, label]) => label)
        .concat((filter.incomeRanges as string[] | undefined) ?? [])
    : []

  const route = routeQuery.data
  const targets =
    route?.stops.flatMap((stop) =>
      stop.addresses.flatMap((address) => address.targets),
    ) ?? []
  const reached = targets.filter(
    (target) => target.knockStatus !== 'unknown',
  ).length

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background">
      <div className="border-b border-border px-6 py-4">
        <div className="mx-auto flex w-full max-w-2xl items-start gap-3">
          <span
            className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: turf.color }}
          />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{turf.name}</h2>
            <p className="text-sm text-muted-foreground">
              Overview of this list, its route, and applied filters.
            </p>
          </div>
          <IconButton aria-label="Close details" onClick={onClose}>
            <XMarkIcon size={18} />
          </IconButton>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-info">
              Overview
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <Stat
                label="Households"
                value={(
                  route?.route.stopCount ??
                  areaStats?.stops ??
                  0
                ).toLocaleString()}
              />
              <Stat
                label="People"
                value={(targets.length > 0
                  ? targets.length
                  : (areaStats?.people ?? 0)
                ).toLocaleString()}
              />
              <Stat
                label="Estimated time"
                value={
                  route
                    ? formatDuration(route.route.totalSeconds)
                    : 'Not knocked yet'
                }
              />
              <Stat
                label="Route type"
                value={
                  route
                    ? route.route.mode === 'walk'
                      ? `Walk route${route.route.loop ? ' · loop' : ''}`
                      : `Drive route${route.route.loop ? ' · loop' : ''}`
                    : 'Not knocked yet'
                }
              />
              <Stat
                label="Created"
                value={new Date(turf.createdAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              />
              <Stat
                label="Progress"
                value={
                  route
                    ? `${reached} of ${targets.length} · ${
                        targets.length > 0
                          ? Math.round((reached / targets.length) * 100)
                          : 0
                      }%`
                    : 'Not knocked yet'
                }
              />
            </div>
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-info">
              Applied filters
            </h3>
            {appliedFilterLabels.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No filters applied — this list targets all contacts.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {appliedFilterLabels.map((label) => (
                  <span
                    key={label}
                    className="rounded-full border border-border px-2.5 py-1 text-xs"
                  >
                    {label}
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

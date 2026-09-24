'use client'

import { Fragment, useMemo, useState } from 'react'
import {
  ChevronRight,
  ChevronsUpDown,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { Badge } from '@goodparty_org/styleguide'
import { data, type EventRecord } from '../lib/data'
import { lineageOf } from '../lib/lineage'
import { TONE_CLASS, verdictFor } from '../lib/verdict'
import { EventDetail } from './EventDetail'
import { Sparkline } from './Sparkline'

type SortKey = 'name' | 'area' | 'added' | 'state' | 'count'
type Dir = 'asc' | 'desc'

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'name', label: 'Event' },
  { key: 'area', label: 'Area' },
  { key: 'added', label: 'Added' },
  { key: 'state', label: 'State' },
  { key: 'count', label: '30d', numeric: true },
]

// Worst first when sorting by state: the reason to sort by it is to find the problems.
const STATE_ORDER: Record<string, number> = {
  orphaned_firing: 0,
  instrumented_never_observed: 1,
  dormant: 2,
  deprecating: 3,
  code_unknown: 4,
  active: 5,
  retired: 6,
  system: 7,
}

const valueOf = (e: EventRecord, key: SortKey): string | number => {
  switch (key) {
    case 'name':
      return e.display_name.toLowerCase()
    case 'area':
      return e.area.toLowerCase()
    case 'added':
      return e.provenance.instrumented_date || ''
    case 'state':
      return STATE_ORDER[e.status] ?? 9
    case 'count':
      return e.count_30d
  }
}

export const EventTable = ({ events }: { events: EventRecord[] }) => {
  const [open, setOpen] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir } | null>(null)

  const rows = useMemo(() => {
    if (!sort) return events
    const out = [...events]
    out.sort((a, b) => {
      const av = valueOf(a, sort.key)
      const bv = valueOf(b, sort.key)
      // An unknown date sorts last in both directions rather than pretending to be
      // the oldest event we have.
      if (av === '' && bv === '') return 0
      if (av === '') return 1
      if (bv === '') return -1
      if (av === bv) return 0
      const cmp = av < bv ? -1 : 1
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return out
  }, [events, sort])

  const clickSort = (key: SortKey) =>
    setSort((s) =>
      s?.key !== key
        ? { key, dir: key === 'count' || key === 'added' ? 'desc' : 'asc' }
        : s.dir === 'asc'
          ? { key, dir: 'desc' }
          : null,
    )

  if (!events.length) {
    return (
      <p className="rounded-lg border p-6 text-sm text-muted-foreground">
        No events match.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="w-8" />
            {COLUMNS.map((c) => {
              const on = sort?.key === c.key
              const Icon = !on
                ? ChevronsUpDown
                : sort.dir === 'asc'
                  ? ChevronUp
                  : ChevronDown
              return (
                <th
                  key={c.key}
                  className={`px-3 py-2 font-medium ${c.numeric ? 'text-right' : ''}`}
                  aria-sort={
                    on
                      ? sort.dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  <button
                    type="button"
                    onClick={() => clickSort(c.key)}
                    className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground ${
                      on ? 'text-foreground' : ''
                    }`}
                  >
                    {c.label}
                    <Icon className="h-3 w-3" />
                  </button>
                </th>
              )
            })}
            <th className="px-3 py-2 font-medium">Trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const v = verdictFor(e)
            const isOpen = open === e.event_type
            const l = lineageOf(e)
            const hint = l.replacedBy
              ? `→ ${l.replacedBy.display_name}`
              : l.replacedByArea
                ? `→ ${l.replacedByArea} family`
                : l.unparsed
                  ? 'replacement recorded in prose'
                  : l.deadEnd
                    ? 'no replacement'
                    : ''
            return (
              <Fragment key={e.event_type}>
                <tr
                  onClick={() => setOpen(isOpen ? null : e.event_type)}
                  className="cursor-pointer border-t hover:bg-muted/40"
                >
                  <td className="pl-3">
                    <ChevronRight
                      className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{e.display_name}</div>
                    {e.description && (
                      <div className="line-clamp-1 text-xs text-muted-foreground">
                        {e.description}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{e.area}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">
                    {e.provenance.instrumented_date || (
                      <span title="No provenance row could attribute a commit">
                        unknown
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge className={TONE_CLASS[v.tone]}>{v.label}</Badge>
                    {hint && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {hint}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {e.count_30d.toLocaleString('en-US')}
                  </td>
                  <td className="px-3 py-2">
                    <Sparkline
                      values={e.series}
                      weeks={data.series_weeks}
                      width={72}
                      height={18}
                    />
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-t">
                    <td colSpan={7} className="p-0">
                      <EventDetail event={e} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

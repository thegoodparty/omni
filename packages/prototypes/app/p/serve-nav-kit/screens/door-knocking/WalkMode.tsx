'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  FilterPill,
  FilterPillGroup,
  cn,
} from '@goodparty_org/styleguide'
import {
  Car,
  ChevronDown,
  ChevronRight,
  Footprints,
  MapPin,
  MapPinOff,
  Repeat,
  User,
  Users,
} from 'lucide-react'
import { MapCanvas } from './MapCanvas'
import { Legend } from './Legend'
import {
  type Resident,
  type ResidentStatus,
  type Voter,
  STATUS_DOT,
  buildRoute,
  formatDuration,
  getDoorOutcomeMeta,
  getHouseholdCount,
  getResidents,
  getVoterCounts,
  legMeta,
  listMode,
} from './doorKnockingData'

type Props = {
  voters: Voter[]
  activeId?: string | null
  onTapVoter: (voter: Voter, residentId?: string) => void
  onDelete: () => void
}

const residentMeta = (voter: Voter, r: Resident) => {
  const stored = voter.residentStatuses?.[r.id]
  const isPrimary = r.relation === 'self'
  const status: ResidentStatus = stored?.reached
    ? stored
    : isPrimary && voter.reached
      ? {
          reached: true,
          outcome: voter.outcome,
          support: voter.support,
          engagement: voter.engagement,
        }
      : { reached: false }
  const meta = getDoorOutcomeMeta(status)
  return meta
    ? { label: meta.label, dot: STATUS_DOT[meta.color] }
    : { label: 'Support unknown', dot: 'bg-muted-foreground/40' }
}

export const WalkMode = ({ voters, activeId, onTapVoter, onDelete }: Props) => {
  const route = useMemo(() => buildRoute(voters), [voters])
  const [travelMode, setTravelMode] = useState<'walk' | 'drive'>(() =>
    listMode(voters),
  )
  const [loop, setLoop] = useState(false)
  const [showLocation, setShowLocation] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [mapCompact, setMapCompact] = useState(false)
  const [activePinId, setActivePinId] = useState<string | null>(null)
  const stopRefs = useRef<Record<string, HTMLLIElement | null>>({})

  // Keep the default travel mode in sync with the route (walkable → walk).
  useEffect(() => {
    setTravelMode(listMode(voters))
  }, [voters])

  // The map compacts once the list is scrolled into view (source parity).
  useEffect(() => {
    let lockedUntil = 0
    const onScroll = () => {
      if (performance.now() < lockedUntil) return
      setMapCompact((prev) => {
        const y = window.scrollY
        let next = prev
        if (!prev && y > 220) next = true
        else if (prev && y < 40) next = false
        if (next !== prev) lockedUntil = performance.now() + 500
        return next
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const counts = getVoterCounts(voters)
  const total = voters.length
  const reached = voters.filter((v) => v.reached).length
  const liveIndex = Math.max(
    0,
    route.findIndex((v) => !v.reached),
  )

  const minutes = useMemo(() => {
    let m = 2
    for (let i = 1; i < route.length; i++) {
      const leg = legMeta(route[i - 1]!, route[i]!)
      m += travelMode === 'walk' ? leg.walkMin : leg.driveMin
      m += 2
    }
    if (loop && route.length > 1) {
      const leg = legMeta(route[route.length - 1]!, route[0]!)
      m += travelMode === 'walk' ? leg.walkMin : leg.driveMin
    }
    return Math.round(m)
  }, [route, travelMode, loop])

  // Tapping a map pin highlights that stop in the list and scrolls to it — it
  // does not open the person drawer (source parity).
  const handlePinTap = (v: Voter) => {
    setActivePinId(v.id)
    stopRefs.current[v.id]?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }

  const pct = (c: number) => (total > 0 ? (c / total) * 100 : 0)
  const barSegments: { key: keyof typeof counts; cls: string }[] = [
    { key: 'green', cls: 'bg-success' },
    { key: 'crimson', cls: 'bg-destructive' },
    { key: 'orange', cls: 'bg-yellow-400' },
    { key: 'purple', cls: 'bg-muted-foreground' },
    { key: 'slate', cls: 'bg-foreground' },
  ]

  return (
    <div className="space-y-4">
      {/* Map — full width, sticky, compacting on scroll (like the source). */}
      <div
        className={cn(
          'border-border bg-background sticky top-28 z-20 w-full overflow-hidden border-b transition-[height] duration-300 ease-out',
          mapCompact ? 'h-[160px] lg:h-[220px]' : 'h-[280px] lg:h-[360px]',
        )}
      >
        <MapCanvas
          mode="walk"
          voters={voters}
          listVoterIds={new Set(voters.map((v) => v.id))}
          route={route}
          liveIndex={showLocation ? liveIndex : undefined}
          onHouseTap={handlePinTap}
          className="h-full w-full"
        />
      </div>

      {/* Everything below the map sits in the fixed reading column. */}
      <div className="mx-auto w-full max-w-[608px] space-y-4 px-4 pb-28">
        {/* Controls — single non-wrapping row; FilterPill is one size in the DS,
            so on narrow screens the row scrolls horizontally instead of wrapping. */}
        <div className="scrollbar-none flex flex-nowrap items-center gap-2 overflow-x-auto">
          <FilterPillGroup
            type="single"
            className="shrink-0"
            value={showLocation ? 'on' : ''}
            onValueChange={(v) => setShowLocation(v === 'on')}
          >
            <FilterPill value="on" className="gap-1.5">
              {showLocation ? (
                <MapPin className="size-4" />
              ) : (
                <MapPinOff className="size-4" />
              )}
              My live location
            </FilterPill>
          </FilterPillGroup>

          <FilterPillGroup
            type="single"
            aria-label="Travel mode"
            className="shrink-0"
            value={travelMode}
            onValueChange={(v) => v && setTravelMode(v as 'walk' | 'drive')}
          >
            <FilterPill value="drive" aria-label="Drive">
              <Car className="size-4" />
            </FilterPill>
            <FilterPill value="walk" aria-label="Walk">
              <Footprints className="size-4" />
            </FilterPill>
          </FilterPillGroup>

          <FilterPillGroup
            type="single"
            className="shrink-0"
            value={loop ? 'on' : ''}
            onValueChange={(v) => setLoop(v === 'on')}
          >
            <FilterPill value="on" className="gap-1.5">
              <Repeat className="size-4" />
              Loop
            </FilterPill>
          </FilterPillGroup>
        </div>

        {/* Progress */}
        <Card className="gap-3 p-4">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              In this list
            </span>
            <Badge variant="secondary" shape="pill">
              {reached}/{total} reached
            </Badge>
          </div>
          <div className="bg-muted flex h-2 overflow-hidden rounded-full">
            {barSegments.map((s) => (
              <span
                key={s.key}
                className={s.cls}
                style={{ width: `${pct(counts[s.key])}%` }}
              />
            ))}
          </div>
          <Legend readOnly voters={voters} />
        </Card>

        {/* Stops */}
        <Card className="gap-0 overflow-hidden p-0">
          <div className="border-border bg-card flex items-center justify-between border-b p-4">
            <span className="text-foreground text-sm font-semibold">Stops</span>
            <span className="text-muted-foreground text-sm">
              {route.length} doors · {formatDuration(minutes)}
            </span>
          </div>
          <ol className="divide-border divide-y">
            {route.map((v, i) => {
              const residents = getResidents(v)
              const multi = residents.length > 1
              const isOpen = expanded === v.id
              const leg = i > 0 ? legMeta(route[i - 1]!, v) : null
              // The stop is "active" when its map pin was tapped, its panel is
              // open, or its residents are expanded — all highlight the row.
              const active = activePinId === v.id || activeId === v.id || isOpen
              return (
                <li
                  key={v.id}
                  ref={(el) => {
                    stopRefs.current[v.id] = el
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActivePinId(v.id)
                      if (multi) setExpanded(isOpen ? null : v.id)
                      else onTapVoter(v)
                    }}
                    className={cn(
                      'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
                      active ? 'bg-primary/10' : 'hover:bg-muted/50',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground',
                      )}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground truncate text-sm font-medium">
                        {v.name}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {v.address}
                      </p>
                      <div className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
                        <Users className="size-3.5" />
                        {getHouseholdCount(v)}
                        <span className="flex items-center gap-1">
                          {residents.map((r) => (
                            <span
                              key={r.id}
                              className={cn(
                                'size-2 rounded-full',
                                residentMeta(v, r).dot,
                              )}
                            />
                          ))}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 self-center">
                      {leg && (
                        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                          {travelMode === 'walk' ? (
                            <Footprints className="text-info size-3.5" />
                          ) : (
                            <Car className="text-info size-3.5" />
                          )}
                          {Math.ceil(
                            travelMode === 'walk' ? leg.walkMin : leg.driveMin,
                          )}
                          m {travelMode}
                        </span>
                      )}
                      {multi ? (
                        <ChevronDown
                          className={cn(
                            'text-muted-foreground size-4 transition-transform',
                            isOpen && 'rotate-180',
                          )}
                        />
                      ) : (
                        <ChevronRight className="text-muted-foreground size-4" />
                      )}
                    </div>
                  </button>

                  {multi && isOpen && (
                    <ul className="border-border bg-muted/30 divide-border divide-y border-t">
                      {residents.map((r) => {
                        const meta = residentMeta(v, r)
                        return (
                          <li key={r.id}>
                            <button
                              type="button"
                              onClick={() => onTapVoter(v, r.id)}
                              className="hover:bg-muted/50 flex w-full items-center gap-3 py-3 pr-4 pl-14 text-left"
                            >
                              <User className="text-muted-foreground size-4 shrink-0" />
                              <span className="text-foreground flex-1 truncate text-sm">
                                {r.name}
                              </span>
                              <span className="border-border text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
                                <span
                                  className={cn(
                                    'size-2 rounded-full',
                                    meta.dot,
                                  )}
                                />
                                {meta.label}
                              </span>
                              <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              )
            })}
          </ol>
        </Card>

        <Button
          variant="ghost"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive w-full"
          onClick={onDelete}
        >
          Delete list
        </Button>
      </div>
    </div>
  )
}

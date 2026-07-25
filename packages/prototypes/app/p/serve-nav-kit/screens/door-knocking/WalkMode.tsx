'use client'

import { useMemo, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Home,
  MapPin,
  Users,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  FilterPill,
  FilterPillGroup,
  IconButton,
  Label,
  Progress,
  Textarea,
  cn,
} from '@goodparty_org/styleguide'
import { ArrowLeftIcon } from '@styleguide/components/ui/icons'
import {
  type DoorList,
  type DoorOutcome,
  type DoorRecord,
  type Support,
  type Voter,
  OUTCOME_OPTIONS,
  PARTY_LABEL,
  SUPPORT_OPTIONS,
  getHouseholdCount,
  votersFor,
} from './doorKnockingData'

type Props = {
  list: DoorList
  records: Record<string, DoorRecord>
  onRecord: (voterId: string, record: DoorRecord | null) => void
  onExit: () => void
}

const OUTCOME_LABEL: Record<DoorOutcome, string> = {
  answered: 'Answered',
  not_home: 'Not home',
  not_accessible: "Can't access",
}

export const WalkMode = ({ list, records, onRecord, onExit }: Props) => {
  const route = useMemo(() => votersFor(list), [list])
  const [index, setIndex] = useState(0)
  const current = route[index]

  const knocked = route.filter((v) => records[v.id]).length
  const progress = route.length ? Math.round((knocked / route.length) * 100) : 0

  if (!current) return null

  const rec = records[current.id]
  const setOutcome = (outcome: DoorOutcome) =>
    onRecord(current.id, { ...rec, outcome })
  const setSupport = (support: Support) =>
    onRecord(current.id, { outcome: rec?.outcome ?? 'answered', support })
  const setNote = (note: string) =>
    onRecord(current.id, { outcome: rec?.outcome ?? 'answered', ...rec, note })

  const go = (delta: number) =>
    setIndex((i) => Math.min(route.length - 1, Math.max(0, i + delta)))

  return (
    <div className="mx-auto flex w-full max-w-[608px] flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <IconButton
          variant="outline"
          size="small"
          aria-label="Back to lists"
          onClick={onExit}
        >
          <ArrowLeftIcon className="size-4" />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h2 className="text-foreground truncate text-lg font-semibold">
            {list.name}
          </h2>
          <p className="text-muted-foreground text-sm">
            {knocked} / {route.length} doors knocked
          </p>
        </div>
      </div>
      <Progress value={progress} />

      {/* Current door */}
      <Card className="gap-4 p-4 shadow-none sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              Door {index + 1} of {route.length}
            </p>
            <h3 className="text-foreground mt-1 text-xl font-semibold">
              {current.address}
            </h3>
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-3.5" />
                {getHouseholdCount(current)}{' '}
                {getHouseholdCount(current) === 1 ? 'resident' : 'residents'}
              </span>
              <span>{current.name}</span>
            </div>
          </div>
          <Badge variant="secondary" shape="pill">
            {PARTY_LABEL[current.party]}
          </Badge>
        </div>

        {/* Outcome */}
        <div className="space-y-2">
          <Label>Outcome</Label>
          <FilterPillGroup
            type="single"
            value={rec?.outcome ?? ''}
            onValueChange={(v) => v && setOutcome(v as DoorOutcome)}
          >
            {OUTCOME_OPTIONS.map((o) => (
              <FilterPill key={o.id} value={o.id}>
                {o.label}
              </FilterPill>
            ))}
          </FilterPillGroup>
        </div>

        {/* Support + note only when answered */}
        {rec?.outcome === 'answered' && (
          <>
            <div className="space-y-2">
              <Label>Support</Label>
              <FilterPillGroup
                type="single"
                value={rec.support ?? ''}
                onValueChange={(v) => v && setSupport(v as Support)}
              >
                {SUPPORT_OPTIONS.map((s) => (
                  <FilterPill key={s.id} value={s.id}>
                    {s.label}
                  </FilterPill>
                ))}
              </FilterPillGroup>
            </div>
            <div className="space-y-2">
              <Label htmlFor="door-note">Note</Label>
              <Textarea
                id="door-note"
                value={rec.note ?? ''}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What did you hear at the door?"
                className="min-h-[80px] resize-none [field-sizing:content]"
              />
            </div>
          </>
        )}
      </Card>

      {/* Nav */}
      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" disabled={index === 0} onClick={() => go(-1)}>
          <ChevronLeft className="size-4" />
          Previous
        </Button>
        {index < route.length - 1 ? (
          <Button onClick={() => go(1)}>
            Next door
            <ChevronRight className="size-4" />
          </Button>
        ) : (
          <Button onClick={onExit}>
            <Check className="size-4" />
            Finish
          </Button>
        )}
      </div>

      {/* Route overview */}
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Route
        </p>
        <div className="divide-border overflow-hidden rounded-xl border">
          {route.map((v, i) => (
            <RouteRow
              key={v.id}
              voter={v}
              record={records[v.id]}
              active={i === index}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

const RouteRow = ({
  voter,
  record,
  active,
  onClick,
}: {
  voter: Voter
  record?: DoorRecord
  active: boolean
  onClick: () => void
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'border-border flex w-full items-center gap-3 border-b p-3 text-left transition-colors last:border-b-0',
      active ? 'bg-muted' : 'hover:bg-muted',
    )}
  >
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full',
        record
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted-foreground/10',
      )}
    >
      {record ? (
        <Check className="size-4" />
      ) : (
        <MapPin className="text-muted-foreground size-4" />
      )}
    </span>
    <span className="min-w-0 flex-1">
      <span className="text-foreground block truncate text-sm font-medium">
        {voter.address}
      </span>
      <span className="text-muted-foreground block truncate text-xs">
        {voter.name}
      </span>
    </span>
    {record && (
      <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
        <Home className="size-3.5" />
        {OUTCOME_LABEL[record.outcome]}
      </span>
    )}
  </button>
)

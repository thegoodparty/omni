'use client'

import {
  Badge,
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  cn,
} from '@goodparty_org/styleguide'
import { Footprints, Home, Trash2, Users } from 'lucide-react'
import {
  type DoorList,
  type DoorRecord,
  type Support,
  DEFAULT_LIST_COLOR,
  LIST_COLOR_HEX,
  PARTY_LABEL,
  darkenHex,
  getHouseholdCount,
  votersFor,
} from './doorKnockingData'

type Props = {
  list: DoorList | null
  records: Record<string, DoorRecord>
  canWalk: boolean
  onOpenChange: (v: boolean) => void
  onWalk?: () => void
  onDelete?: () => void
}

const SUPPORT_META: Record<Support, { label: string; className: string }> = {
  yes: { label: 'Supporter', className: 'text-success' },
  no: { label: 'Not supporting', className: 'text-destructive' },
  unknown: { label: 'Undecided', className: 'text-muted-foreground' },
}

export const ListDetailsSheet = ({
  list,
  records,
  canWalk,
  onOpenChange,
  onWalk,
  onDelete,
}: Props) => {
  const voters = list ? votersFor(list) : []
  const people = voters.reduce((s, v) => s + getHouseholdCount(v), 0)
  const knocked = voters.filter((v) => records[v.id]).length
  const supporters = voters.filter(
    (v) => records[v.id]?.support === 'yes',
  ).length

  const stats = [
    { label: 'Households', value: voters.length, icon: Home },
    { label: 'People', value: people, icon: Users },
    { label: 'Knocked', value: knocked },
    { label: 'Supporters', value: supporters },
  ]

  return (
    <Sheet open={list !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-border border-b p-4">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-full"
              style={{
                backgroundColor: darkenHex(
                  LIST_COLOR_HEX[list?.color ?? DEFAULT_LIST_COLOR],
                  40,
                ),
              }}
            />
            <SheetTitle className="truncate text-left">
              {list?.name ?? 'List'}
            </SheetTitle>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {/* Stat grid */}
          <div className="border-border grid grid-cols-2 gap-px border-b">
            {stats.map((s) => (
              <div key={s.label} className="bg-background p-4">
                <p className="text-foreground text-2xl font-semibold">
                  {s.value.toLocaleString()}
                </p>
                <p className="text-muted-foreground text-sm">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Roster */}
          <div className="divide-border divide-y">
            {voters.map((v) => {
              const rec = records[v.id]
              const support = rec?.support ? SUPPORT_META[rec.support] : null
              return (
                <div key={v.id} className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate text-sm font-medium">
                      {v.address}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {v.name} · {PARTY_LABEL[v.party]}
                    </p>
                  </div>
                  {rec ? (
                    support ? (
                      <span
                        className={cn('text-xs font-medium', support.className)}
                      >
                        {support.label}
                      </span>
                    ) : (
                      <Badge variant="secondary" shape="pill">
                        {rec.outcome === 'not_home' ? 'Not home' : 'Answered'}
                      </Badge>
                    )
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      Not knocked
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="border-border flex items-center gap-2 border-t p-4">
          {onDelete && (
            <Button variant="outline" onClick={onDelete}>
              <Trash2 className="size-4" />
              Delete
            </Button>
          )}
          {canWalk && onWalk && (
            <Button className="flex-1" onClick={onWalk}>
              <Footprints className="size-4" />
              Knock doors
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  FilterPill,
  FilterPillGroup,
  Input,
  Label,
  cn,
} from '@goodparty_org/styleguide'
import { SectionLabel } from '../../components/SectionLabel'
import {
  type DoorList,
  type ListColor,
  type Party,
  DK_PARTIES,
  DK_PRECINCTS,
  DEFAULT_LIST_COLOR,
  LIST_COLOR_OPTIONS,
  PARTY_LABEL,
  estimatedMinutes,
  filterVoters,
} from './doorKnockingData'

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreate: (list: DoorList) => void
}

export const NewListDrawer = ({ open, onOpenChange, onCreate }: Props) => {
  const [precincts, setPrecincts] = useState<string[]>([])
  const [parties, setParties] = useState<Party[]>([])
  const [notReached, setNotReached] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState<ListColor>(DEFAULT_LIST_COLOR)

  const matched = useMemo(
    () => filterVoters({ precincts, parties, notReached }),
    [precincts, parties, notReached],
  )
  const count = matched.length

  const reset = () => {
    setPrecincts([])
    setParties([])
    setNotReached(false)
    setName('')
    setColor(DEFAULT_LIST_COLOR)
  }

  const create = () => {
    if (count === 0) return
    onCreate({
      id: `list-${Date.now()}`,
      name: name.trim() || `New list (${count})`,
      voterIds: matched.map((v) => v.id),
      color,
      createdAt: new Date().toISOString().slice(0, 10),
      durationMin: estimatedMinutes(count),
    })
    reset()
    onOpenChange(false)
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DrawerContent className="flex h-[calc(100dvh-4rem)] flex-col p-0 data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-4rem)] lg:h-[calc(100dvh-8rem)] lg:data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-8rem)]">
        <DrawerHandle />
        <DrawerHeader className="sr-only">
          <DrawerTitle>Build a new list</DrawerTitle>
        </DrawerHeader>

        <div className="border-border shrink-0 border-b px-4 py-4 lg:px-6">
          <div className="mx-auto w-full max-w-[608px]">
            <h2 className="text-foreground text-lg font-semibold">
              Build a new list
            </h2>
            <p className="text-muted-foreground text-sm">
              Pick who to canvass. We’ll cut a walkable list from your voters.
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 lg:px-6">
          <div className="mx-auto w-full max-w-[608px] space-y-6">
            <div className="space-y-2">
              <SectionLabel>Precinct</SectionLabel>
              <FilterPillGroup
                type="multiple"
                value={precincts}
                onValueChange={setPrecincts}
              >
                {DK_PRECINCTS.map((p) => (
                  <FilterPill key={p} value={p}>
                    {p}
                  </FilterPill>
                ))}
              </FilterPillGroup>
            </div>

            <div className="space-y-2">
              <SectionLabel>Party</SectionLabel>
              <FilterPillGroup
                type="multiple"
                value={parties}
                onValueChange={(v) => setParties(v as Party[])}
              >
                {DK_PARTIES.map((p) => (
                  <FilterPill key={p} value={p}>
                    {PARTY_LABEL[p]}
                  </FilterPill>
                ))}
              </FilterPillGroup>
            </div>

            <div className="space-y-2">
              <SectionLabel>Status</SectionLabel>
              <FilterPillGroup
                type="multiple"
                value={notReached ? ['not_reached'] : []}
                onValueChange={(v) => setNotReached(v.includes('not_reached'))}
              >
                <FilterPill value="not_reached">Not yet knocked</FilterPill>
              </FilterPillGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-list-name">List name</Label>
              <Input
                id="new-list-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Precinct 3 — weekend walk"
                maxLength={50}
              />
            </div>

            <div className="space-y-2">
              <SectionLabel>Turf color</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {LIST_COLOR_OPTIONS.map((opt) => {
                  const active = color === opt.id
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      aria-label={opt.label}
                      aria-pressed={active}
                      onClick={() => setColor(opt.id)}
                      className={cn(
                        'ring-offset-background flex size-8 items-center justify-center rounded-full transition-transform',
                        active && 'ring-primary-focus ring-2 ring-offset-2',
                      )}
                      style={{ backgroundColor: opt.hex }}
                    >
                      {active && <Check className="size-4 text-white" />}
                    </button>
                  )
                })}
              </div>
            </div>

            <p className="text-muted-foreground text-sm">
              {count.toLocaleString()} households · about{' '}
              {estimatedMinutes(count)} min to walk
            </p>
          </div>
        </div>

        <div className="border-border bg-background shrink-0 border-t px-4 py-3 lg:px-6">
          <div className="mx-auto w-full max-w-[608px]">
            <Button className="w-full" disabled={count === 0} onClick={create}>
              Create list ({count.toLocaleString()})
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

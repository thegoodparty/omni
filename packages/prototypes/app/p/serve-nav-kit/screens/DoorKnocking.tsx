'use client'

import { useMemo, useState } from 'react'
import { MapPin, Plus } from 'lucide-react'
import { Button, Card, Progress, cn, toast } from '@goodparty_org/styleguide'
import { ScreenLayout } from '../components/ScreenLayout'
import { SectionLabel } from '../components/SectionLabel'
import { ListCard } from './door-knocking/ListCard'
import {
  type DoorList,
  DOOR_GOAL,
  RECOMMENDED_LISTS,
  SAVED_LISTS,
  fmtDuration,
  votersFor,
} from './door-knocking/doorKnockingData'

type DoorKnockingProps = {
  title: string
  aiPlaceholder?: string
}

export const DoorKnocking = ({ title, aiPlaceholder }: DoorKnockingProps) => {
  const [saved, setSaved] = useState<DoorList[]>(SAVED_LISTS)
  const [recommended, setRecommended] = useState<DoorList[]>(RECOMMENDED_LISTS)

  const doorsKnocked = useMemo(
    () =>
      saved.reduce(
        (sum, list) => sum + votersFor(list).filter((v) => v.reached).length,
        0,
      ),
    [saved],
  )
  const progress = Math.min(100, Math.round((doorsKnocked / DOOR_GOAL) * 100))

  const soon = () =>
    toast('Coming soon', {
      description:
        'The map, route builder, and walk mode land in the next pass.',
    })

  return (
    <ScreenLayout title={title} aiPlaceholder={aiPlaceholder} width="wide">
      {/* Goal progress */}
      <Card className="gap-3 p-4 shadow-none sm:p-5">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-muted-foreground text-sm">Doors knocked</p>
            <p className="text-foreground text-2xl font-semibold">
              {doorsKnocked.toLocaleString()}{' '}
              <span className="text-muted-foreground text-base font-normal">
                / {DOOR_GOAL.toLocaleString()} goal
              </span>
            </p>
          </div>
          <Button onClick={soon}>
            <Plus className="size-4" />
            New list
          </Button>
        </div>
        <Progress value={progress} />
      </Card>

      {/* Map placeholder (real map lands in a later phase) */}
      <Card className="text-muted-foreground items-center justify-center gap-2 border-dashed p-8 text-center shadow-none">
        <MapPin className="size-6" />
        <p className="text-sm">
          Route map coming next — this phase covers list management.
        </p>
      </Card>

      {/* Recommended lists */}
      {recommended.length > 0 && (
        <section className="space-y-3">
          <SectionLabel>Recommended lists</SectionLabel>
          <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-3')}>
            {recommended.map((list) => (
              <ListCard
                key={list.id}
                variant="recommended"
                title={list.name}
                voters={votersFor(list)}
                duration={fmtDuration(list.durationMin)}
                reason={list.reason}
                onClick={soon}
                onDetails={soon}
                onSave={() => {
                  setSaved((prev) => [
                    { ...list, id: `saved-${list.id}`, color: 'violet' },
                    ...prev,
                  ])
                  setRecommended((prev) => prev.filter((r) => r.id !== list.id))
                  toast('List saved', { description: list.name })
                }}
                onDelete={() =>
                  setRecommended((prev) => prev.filter((r) => r.id !== list.id))
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Your lists */}
      <section className="space-y-3">
        <SectionLabel>Your lists</SectionLabel>
        {saved.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No lists yet. Save a recommended list or build a new one.
          </p>
        ) : (
          <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-3')}>
            {saved.map((list) => (
              <ListCard
                key={list.id}
                variant="saved"
                title={list.name}
                voters={votersFor(list)}
                duration={fmtDuration(list.durationMin)}
                color={list.color}
                onClick={soon}
                onWalk={soon}
                onDetails={soon}
                onDelete={() =>
                  setSaved((prev) => prev.filter((s) => s.id !== list.id))
                }
              />
            ))}
          </div>
        )}
      </section>
    </ScreenLayout>
  )
}

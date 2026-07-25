'use client'

import { useState } from 'react'
import { MapPin, Plus } from 'lucide-react'
import { Button, Card, Progress, cn, toast } from '@goodparty_org/styleguide'
import { ScreenLayout } from '../components/ScreenLayout'
import { SectionLabel } from '../components/SectionLabel'
import { ListCard } from './door-knocking/ListCard'
import { WalkMode } from './door-knocking/WalkMode'
import { NewListDrawer } from './door-knocking/NewListDrawer'
import { ListDetailsSheet } from './door-knocking/ListDetailsSheet'
import {
  type DoorList,
  type DoorRecord,
  DOOR_GOAL,
  RECOMMENDED_LISTS,
  SAVED_LISTS,
  fmtDuration,
  initialRecords,
  votersFor,
} from './door-knocking/doorKnockingData'

type DoorKnockingProps = {
  title: string
  aiPlaceholder?: string
}

export const DoorKnocking = ({ title, aiPlaceholder }: DoorKnockingProps) => {
  const [saved, setSaved] = useState<DoorList[]>(SAVED_LISTS)
  const [recommended, setRecommended] = useState<DoorList[]>(RECOMMENDED_LISTS)
  const [records, setRecords] =
    useState<Record<string, DoorRecord>>(initialRecords)
  const [walkListId, setWalkListId] = useState<string | null>(null)
  const [newListOpen, setNewListOpen] = useState(false)
  const [detailsList, setDetailsList] = useState<DoorList | null>(null)

  const walkList = saved.find((l) => l.id === walkListId) ?? null
  const detailsIsSaved =
    detailsList !== null && saved.some((l) => l.id === detailsList.id)

  // Inject live canvass progress into a list's voters so the cards update.
  const listVoters = (list: DoorList) =>
    votersFor(list).map((v) => ({
      ...v,
      reached: v.reached || !!records[v.id],
    }))

  const doorsKnocked = Object.keys(records).length
  const progress = Math.min(100, Math.round((doorsKnocked / DOOR_GOAL) * 100))

  const recordDoor = (voterId: string, record: DoorRecord | null) =>
    setRecords((prev) => {
      const next = { ...prev }
      if (record) next[voterId] = record
      else delete next[voterId]
      return next
    })

  const soon = () =>
    toast('Coming soon', {
      description: 'The map and new-list builder land in the next pass.',
    })

  if (walkList) {
    return (
      <ScreenLayout title={title} aiPlaceholder={aiPlaceholder} width="wide">
        <WalkMode
          list={walkList}
          records={records}
          onRecord={recordDoor}
          onExit={() => setWalkListId(null)}
        />
      </ScreenLayout>
    )
  }

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
          <Button onClick={() => setNewListOpen(true)}>
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
          Route map coming next — knock doors from any saved list below.
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
                voters={listVoters(list)}
                duration={fmtDuration(list.durationMin)}
                reason={list.reason}
                onClick={soon}
                onDetails={() => setDetailsList(list)}
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
                voters={listVoters(list)}
                duration={fmtDuration(list.durationMin)}
                color={list.color}
                onClick={() => setWalkListId(list.id)}
                onWalk={() => setWalkListId(list.id)}
                onDetails={() => setDetailsList(list)}
                onDelete={() =>
                  setSaved((prev) => prev.filter((s) => s.id !== list.id))
                }
              />
            ))}
          </div>
        )}
      </section>

      <NewListDrawer
        open={newListOpen}
        onOpenChange={setNewListOpen}
        onCreate={(list) => {
          setSaved((prev) => [list, ...prev])
          toast('List created', { description: list.name })
        }}
      />

      <ListDetailsSheet
        list={detailsList}
        records={records}
        canWalk={detailsIsSaved}
        onOpenChange={(v) => !v && setDetailsList(null)}
        onWalk={() => {
          if (detailsList) setWalkListId(detailsList.id)
          setDetailsList(null)
        }}
        onDelete={() => {
          if (detailsList) {
            setSaved((prev) => prev.filter((s) => s.id !== detailsList.id))
            setRecommended((prev) =>
              prev.filter((r) => r.id !== detailsList.id),
            )
          }
          setDetailsList(null)
        }}
      />
    </ScreenLayout>
  )
}

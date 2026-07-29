'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  cn,
  toast,
} from '@goodparty_org/styleguide'
import { Download, MoreVertical, Plus, Trash2 } from 'lucide-react'
import { ScreenLayout } from '../components/ScreenLayout'
import { ListCard } from './door-knocking/ListCard'
import { ListDetailsSheet } from './door-knocking/ListDetailsSheet'
import { Legend } from './door-knocking/Legend'
import { MapCanvas } from './door-knocking/MapCanvas'
import { NewListFlow } from './door-knocking/NewListFlow'
import { SectionHeader } from './door-knocking/SectionHeader'
import { VoterPanel } from './door-knocking/VoterPanel'
import { WalkMode } from './door-knocking/WalkMode'
import {
  type List,
  type StatusColor,
  type Voter,
  ALL_VOTERS,
  RECOMMENDED_LISTS,
  buildRoute,
  formatDuration,
  routeTotalMinutes,
} from './door-knocking/doorKnockingData'

type Props = {
  title: string
  aiPlaceholder?: string
  onExit: () => void
}

export const DoorKnocking = ({ title, aiPlaceholder, onExit }: Props) => {
  const [voters, setVoters] = useState<Voter[]>(ALL_VOTERS)
  const [saved, setSaved] = useState<List[]>([])
  const [recommended, setRecommended] = useState<List[]>(RECOMMENDED_LISTS)
  const [activeListId, setActiveListId] = useState<string | null>(null)
  const [walkListId, setWalkListId] = useState<string | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [detailsList, setDetailsList] = useState<{
    list: List
    kind: 'saved' | 'recommended'
  } | null>(null)
  const [panel, setPanel] = useState<{
    id: string
    residentId?: string
  } | null>(null)
  const [pinFilter, setPinFilter] = useState<StatusColor | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [mapCompact, setMapCompact] = useState(false)

  // Mirror the source: the mobile map shrinks once the list is scrolled into view.
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

  // Entering the walk view should start at the top of the page, not wherever
  // the list was scrolled when the user hit Knock.
  useEffect(() => {
    if (walkListId) window.scrollTo({ top: 0 })
  }, [walkListId])

  // With no saved lists, open the create-list drawer automatically on first
  // arrival only. If the user closes it, they stay on the empty map.
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    if (autoOpenedRef.current) return
    if (saved.length === 0) {
      autoOpenedRef.current = true
      setNewOpen(true)
    }
  }, [saved.length])

  const byId = useMemo(() => new Map(voters.map((v) => [v.id, v])), [voters])
  const listVoters = (list: List): Voter[] =>
    list.voterIds.map((id) => byId.get(id)).filter((v): v is Voter => !!v)

  const walkList = saved.find((l) => l.id === walkListId) ?? null
  const walkVoters = walkList ? listVoters(walkList) : []
  const walkRoute = useMemo(() => buildRoute(walkVoters), [walkVoters])

  const panelVoter = panel ? (byId.get(panel.id) ?? null) : null
  const panelRouteIdx = panelVoter
    ? walkRoute.findIndex((v) => v.id === panelVoter.id)
    : -1

  const displayVoters =
    activeListId && saved.some((l) => l.id === activeListId)
      ? listVoters(saved.find((l) => l.id === activeListId)!)
      : voters

  const savedVoterIds = useMemo(() => {
    const s = new Set<string>()
    saved.forEach((l) => l.voterIds.forEach((id) => s.add(id)))
    return s
  }, [saved])

  const saveVoter = (next: Voter) =>
    setVoters((prev) => prev.map((v) => (v.id === next.id ? next : v)))

  const removeResident = (
    voter: Voter,
    reason: 'moved' | 'opt_out',
    residentId: string,
  ) => {
    saveVoter({
      ...voter,
      removedResidents: {
        ...(voter.removedResidents ?? {}),
        [residentId]: { reason, at: new Date().toISOString() },
      },
    })
  }

  const deleteList = (id: string) => {
    setSaved((prev) => prev.filter((l) => l.id !== id))
    setRecommended((prev) => prev.filter((l) => l.id !== id))
    if (walkListId === id) setWalkListId(null)
    setDeleteId(null)
  }

  const openCreate = () => setNewOpen(true)

  const createListButton = (
    <Button size="small" onClick={openCreate}>
      <Plus className="size-4" />
      Create list
    </Button>
  )

  // -------- Walk view --------
  if (walkList) {
    return (
      <>
        <ScreenLayout
          title={walkList.name}
          aiPlaceholder={aiPlaceholder}
          bleed
          onBack={() => setWalkListId(null)}
          backLabel="Back to lists"
          actions={
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="small"
                aria-label="Download PDF"
                onClick={() => toast('PDF downloaded')}
              >
                <Download className="size-4" />
                <span className="hidden lg:inline">PDF</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    variant="ghost"
                    size="small"
                    aria-label="More actions"
                  >
                    <MoreVertical className="size-4" />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleteId(walkList.id)}
                  >
                    <Trash2 className="size-4" />
                    Delete list
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          }
        >
          <div>
            <WalkMode
              voters={walkVoters}
              activeId={panel?.id ?? null}
              onTapVoter={(v, residentId) => setPanel({ id: v.id, residentId })}
              onDelete={() => setDeleteId(walkList.id)}
            />
          </div>
        </ScreenLayout>

        <VoterPanel
          voter={panelVoter}
          voterIndex={panelRouteIdx >= 0 ? panelRouteIdx + 1 : undefined}
          open={panel !== null}
          onOpenChange={(o) => !o && setPanel(null)}
          onSave={saveVoter}
          onRemove={removeResident}
          initialResidentId={panel?.residentId}
          hasPrev={panelRouteIdx > 0}
          hasNext={panelRouteIdx >= 0 && panelRouteIdx < walkRoute.length - 1}
          onPrev={() =>
            panelRouteIdx > 0 &&
            setPanel({ id: walkRoute[panelRouteIdx - 1]!.id })
          }
          onNext={() =>
            panelRouteIdx >= 0 &&
            panelRouteIdx < walkRoute.length - 1 &&
            setPanel({ id: walkRoute[panelRouteIdx + 1]!.id })
          }
        />

        <DeleteDialog
          open={deleteId !== null}
          onOpenChange={(o) => !o && setDeleteId(null)}
          onConfirm={() => deleteId && deleteList(deleteId)}
        />
      </>
    )
  }

  // -------- Manage view (map-dominant + floating right panel on desktop) --------
  const districtLegend = (
    <>
      <SectionHeader
        title="District voters"
        description={`${voters.length.toLocaleString()} ${
          voters.length === 1 ? 'voter' : 'voters'
        } in your district`}
      />
      <div className="mt-3">
        <Legend
          voters={voters}
          pinFilter={pinFilter}
          onPinFilter={setPinFilter}
        />
      </div>
    </>
  )

  const savedPanel = (
    <div className="space-y-3">
      <SectionHeader
        title={`Saved lists · ${saved.length}`}
        description="Tap a list to highlight it on the map, or Knock to start at the first door."
      />
      <div className="space-y-2">
        {saved.map((list) => (
          <ListCard
            key={list.id}
            variant="saved"
            title={list.name}
            voters={listVoters(list)}
            duration={formatDuration(routeTotalMinutes(listVoters(list)))}
            color={list.color}
            isActive={activeListId === list.id}
            onClick={() =>
              setActiveListId((id) => (id === list.id ? null : list.id))
            }
            onWalk={() => setWalkListId(list.id)}
            onDetails={() => setDetailsList({ list, kind: 'saved' })}
            onDelete={() => setDeleteId(list.id)}
          />
        ))}
        {saved.length === 0 && (
          <Card className="flex flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center">
            <div className="space-y-1">
              <p className="text-foreground text-sm font-semibold">
                No saved lists yet
              </p>
              <p className="text-muted-foreground text-sm">
                Your saved lists will appear here. Create your first list to
                start door knocking.
              </p>
            </div>
            <Button
              size="small"
              className="shrink-0 self-end"
              onClick={openCreate}
            >
              <Plus className="size-4" />
              Create list
            </Button>
          </Card>
        )}
      </div>
    </div>
  )

  return (
    <>
      <ScreenLayout
        title={title}
        aiPlaceholder={aiPlaceholder}
        bleed
        onBack={onExit}
        backLabel="Voter Outreach"
        actions={createListButton}
      >
        <div className="bg-muted pb-28 lg:relative lg:h-[calc(100vh-12rem)] lg:overflow-hidden lg:bg-transparent lg:pb-0">
          {/* Map — full screen: sticky + compacting on mobile, fills the area on desktop */}
          <div
            className={cn(
              'border-border bg-background sticky top-28 z-20 w-full overflow-hidden border-b transition-[height] duration-300 ease-out',
              mapCompact ? 'h-[160px]' : 'h-[280px]',
              'lg:static lg:h-full lg:border-0',
            )}
          >
            <MapCanvas
              voters={displayVoters}
              lists={saved}
              listVoterIds={savedVoterIds}
              pinFilter={pinFilter}
              onHouseTap={(v) => setPanel({ id: v.id })}
              className="h-full w-full"
            />
          </div>

          {/* Mobile: District voters legend directly under the map */}
          <div className="bg-background pb-4 lg:hidden">
            <div className="mx-auto max-w-[608px] px-4 pt-4">
              {districtLegend}
            </div>
          </div>

          {/* Lists: one shared scroll (saved, then recommended) — floating card on
              desktop, stacked full-width on mobile. */}
          <div className="mx-auto max-w-[608px] px-4 py-4 lg:absolute lg:top-4 lg:right-4 lg:bottom-4 lg:z-20 lg:mx-0 lg:flex lg:w-[360px] lg:max-w-[40vw] lg:flex-col lg:px-0 lg:py-0 lg:overflow-hidden lg:rounded-2xl lg:border lg:border-border lg:bg-card lg:shadow-md">
            <div className="space-y-4 lg:flex-1 lg:overflow-y-auto lg:p-4">
              {savedPanel}
            </div>
            <div className="border-border hidden shrink-0 border-t p-4 lg:block">
              {districtLegend}
            </div>
          </div>
        </div>
      </ScreenLayout>

      <NewListFlow
        open={newOpen}
        onOpenChange={setNewOpen}
        recommendations={recommended}
        onRecommendationApplied={(id) =>
          setRecommended((prev) => prev.filter((r) => r.id !== id))
        }
        onCreate={(list) => {
          setSaved((prev) => [list, ...prev])
          toast('List created', { description: list.name })
        }}
      />

      <ListDetailsSheet
        open={detailsList !== null}
        onOpenChange={(o) => !o && setDetailsList(null)}
        list={detailsList?.list ?? null}
        kind={detailsList?.kind ?? 'saved'}
        voters={detailsList ? listVoters(detailsList.list) : []}
      />

      <VoterPanel
        voter={panelVoter}
        open={panel !== null}
        onOpenChange={(o) => !o && setPanel(null)}
        onSave={saveVoter}
        onRemove={removeResident}
        initialResidentId={panel?.residentId}
      />

      <DeleteDialog
        open={deleteId !== null}
        onOpenChange={(o) => !o && setDeleteId(null)}
        onConfirm={() => deleteId && deleteList(deleteId)}
      />
    </>
  )
}

const DeleteDialog = ({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onConfirm: () => void
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={cn('sm:max-w-sm')}>
      <DialogHeader>
        <DialogTitle>Delete this list?</DialogTitle>
        <DialogDescription>
          Are you sure that you want to delete this? This cannot be undone.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onConfirm}>
          Delete list
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
)

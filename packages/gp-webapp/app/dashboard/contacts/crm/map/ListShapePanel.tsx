import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, EmptyState, PlusIcon } from '@styleguide'
import { TurfCard } from 'app/dashboard/door-knocking/native/createFlow/TurfCard'
import {
  useSheetControlsOffset,
  useSheetSnap,
} from 'app/dashboard/door-knocking/native/useSheetSnap'
import { isDrawnShape, type ListShape } from 'app/dashboard/shared/listShapes'

interface ListShapePanelProps {
  shapes: ListShape[]
  // Which shape the map is editing, or -1 before the first one exists.
  activeIndex: number
  // What each shape holds, aligned with `shapes`. The caller ray-casts,
  // because only it has the dots.
  shapeCounts: string[]
  onSelect: (index: number) => void
  onAdd: () => void
  onRemove: (index: number) => void
  onRename: (name: string) => void
  onPickColor: (color: string) => void
  onSave: () => void
  // Asks to leave. The surface decides whether that needs a confirm, because
  // Escape reaches it without going through this panel.
  onCancel: () => void
  isSaving: boolean
  // Whether Save is refused outright. The saved-list surfaces write on Save,
  // so a boundary that catches nobody has nothing behind it.
  saveBlocked: boolean
  // The lines above Save: why it is blocked, or what the count can and
  // cannot promise.
  notes: ReactNode
  // How far up the map this panel reaches, so the map's own chrome clears
  // it. Only meaningful below `lg`, where the panel is over the map.
  onMapControlsOffsetChange: (offsetPx: number | null) => void
}

const DOCKED_CONTROLS_BOTTOM_PX = 16

// The surface this panel sits in is a full-screen layer at z-[1400], above
// the drawers it is opened from, so its confirms have to clear it.
export const DIALOG_LAYER = 'z-[1500]'

// Beside the map rather than over it. Decides only what the panel reports
// to the map, never what it renders; the arrangement is CSS's alone, for the
// reason door knocking's `TurfPanel` records.
const useIsDocked = () => {
  const [docked, setDocked] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)')
    const sync = () => setDocked(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return docked
}

const nameKey = (name: string) => name.trim().toLowerCase()

// The list boundary's shapes, the same way door knocking lists a campaign's
// turfs: one card per shape, the open one being the shape under the cursor,
// with its name and colour editable in place. Docked at `lg`, a bottom sheet
// on the walk's grip below it.
//
// Copied from `TurfPanel` rather than shared with it. That panel carries a
// stop cap, a canvasser picker and saved sibling turfs this one has no use
// for; the card inside both is the shared piece, which is what keeps the two
// surfaces looking like one product.
export const ListShapePanel = ({
  shapes,
  activeIndex,
  shapeCounts,
  onSelect,
  onAdd,
  onRemove,
  onRename,
  onPickColor,
  onSave,
  onCancel,
  isSaving,
  saveBlocked,
  notes,
  onMapControlsOffsetChange,
}: ListShapePanelProps) => {
  const { snap, cycle, gripHandlers, heightClass, sheetRef } =
    useSheetSnap('half')
  const docked = useIsDocked()
  const [attemptedSave, setAttemptedSave] = useState(false)
  // The first shape is introduced, as door knocking's first turf is: a
  // surface that opens straight onto a card asks for a boundary before the
  // map has been moved anywhere.
  const [started, setStarted] = useState(shapes.length > 0)
  const introducing = !started && shapes.length === 0
  // A tap on the map starts the first shape without the button, so the
  // panel follows the map out of its empty state rather than the reverse.
  useEffect(() => {
    if (shapes.length > 0) setStarted(true)
  }, [shapes.length])

  const nameCounts = new Map<string, number>()
  for (const shape of shapes.filter(isDrawnShape)) {
    const key = nameKey(shape.name)
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
  }
  // The shape under the cursor is being drawn, so it is never short of
  // anything yet. One left behind with no boundary is: Save would drop it
  // without a word.
  const problemWith = (shape: ListShape, index: number): string | null => {
    if (!isDrawnShape(shape)) {
      return index === activeIndex ? null : 'Draw this shape'
    }
    if ((nameCounts.get(nameKey(shape.name)) ?? 0) > 1) {
      return 'Two shapes have this name. Change one.'
    }
    return null
  }
  const incomplete = shapes.some((shape, index) => problemWith(shape, index))

  const selectedCardRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    selectedCardRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])
  useSheetControlsOffset(
    sheetRef,
    snap,
    onMapControlsOffsetChange,
    docked ? DOCKED_CONTROLS_BOTTOM_PX : undefined,
  )
  const showBody = snap !== 'peek'

  return (
    <aside
      ref={sheetRef}
      aria-label="Shapes"
      data-snap={snap}
      className={`z-20 flex flex-col overflow-clip bg-card max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:rounded-t-2xl max-lg:border-t max-lg:border-border max-lg:shadow-lg max-lg:transition-[height] max-lg:duration-[260ms] max-lg:ease-out lg:relative lg:w-[430px] lg:shrink-0 lg:border-l lg:border-border ${heightClass} lg:h-full`}
    >
      {/* Children centred with `mx-auto`, never `items-center` — see the
          unlayered `globals.css` rule `TurfPanel` records. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={snap !== 'peek'}
        aria-label={
          snap === 'full' ? 'Collapse the shapes' : 'Expand the shapes'
        }
        className="mx-auto flex w-full shrink-0 cursor-grab touch-none flex-col gap-3 px-4 pt-3 pb-2 lg:hidden"
        {...gripHandlers}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            cycle()
          }
        }}
      >
        <span className="mx-auto h-1.5 w-[120px] shrink-0 rounded-full bg-muted-foreground/50" />
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 px-5 pt-4 pb-3 max-lg:pt-1">
        <h2 className="text-base font-semibold">Shapes</h2>
        {!introducing && (
          <Button type="button" size="small" variant="outline" onClick={onAdd}>
            <PlusIcon className="size-4" />
            Add shape
          </Button>
        )}
      </div>

      {showBody && (
        <div className="-mt-1 min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-4">
          {/* `-mt-1 pt-1` is room for the open card's focus ring, which a
              scroller clips at its top edge; the list does not move. */}
          {introducing && (
            <EmptyState
              title="No shapes yet"
              message="Move the map to the area you want, then draw your first shape."
              action={
                <Button
                  type="button"
                  onClick={() => {
                    setStarted(true)
                    onAdd()
                  }}
                >
                  Draw the first shape
                </Button>
              }
            />
          )}
          {!introducing && (
            <ul className="flex flex-col gap-2">
              {shapes.map((shape, index) => {
                const selected = index === activeIndex
                const unfinished = !isDrawnShape(shape) && !selected
                // `block` on the `li` is load-bearing: `globals.css` forces
                // `display: flex` on every `li` under a `[data-slot]`.
                return (
                  <li key={index} className="block">
                    <TurfCard
                      noun="shape"
                      dialogLayerClassName={DIALOG_LAYER}
                      name={shape.name}
                      color={shape.color}
                      assigneeId={null}
                      team={[]}
                      selected={selected}
                      cardRef={selected ? selectedCardRef : undefined}
                      counts={
                        isDrawnShape(shape)
                          ? shapeCounts[index]
                          : unfinished
                            ? 'Not drawn'
                            : 'Drawing'
                      }
                      onSelect={() => onSelect(index)}
                      onRemove={() => {
                        // Deleting the last card hands the panel back to
                        // its empty state rather than to a heading over
                        // nothing, as door knocking's panel does.
                        if (shapes.length === 1) setStarted(false)
                        onRemove(index)
                      }}
                      onPickColor={onPickColor}
                      onRename={onRename}
                      error={
                        attemptedSave || unfinished
                          ? problemWith(shape, index)
                          : null
                      }
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <div className="flex shrink-0 flex-col gap-2 border-t border-border px-5 py-4">
        {notes}
        <div className="flex gap-3">
          <Button
            type="button"
            variant="ghost"
            className="flex-1"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={saveBlocked}
            loading={isSaving}
            onClick={() => {
              if (incomplete) {
                setAttemptedSave(true)
                return
              }
              onSave()
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </aside>
  )
}

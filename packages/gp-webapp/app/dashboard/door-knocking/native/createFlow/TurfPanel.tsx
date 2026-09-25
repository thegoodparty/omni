import { useEffect, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  EmptyState,
  PlusIcon,
} from '@styleguide'
import { useSheetControlsOffset, useSheetSnap } from '../useSheetSnap'
import type { PolygonStats } from '../filterEngine'
import { isDrawnTurf, type TurfDraft } from '../turfDrafts'
import type { TeamOption } from '../useTeamOptions'
import { DraftCounts } from './draftCounts'
import { TurfCard } from './TurfCard'

interface TurfPanelProps {
  drafts: TurfDraft[]
  // The turf whose boundary is under the cursor, or null while a brand-new
  // one is being drawn and has not reached its third corner. Null is a real
  // state and not a loading one: there is nothing to colour or assign yet.
  active: TurfDraft | null
  // What the next turf will be called, for the null state above.
  pendingName: string
  // Who the next turf will be handed to. Picked before the turf exists and
  // stamped onto it when it does, which is what lets the card that has no
  // draft behind it offer the same two controls as the card that does.
  pendingAssigneeId: number | null
  // The hue the canvas is drawing in. Equal to `active.color` whenever there
  // is an active turf; the separate prop is what lets the panel show the
  // right swatch before the third corner lands.
  drawColor: string
  draftStats: Map<string, PolygonStats>
  // What the campaign's ALREADY-SAVED turfs are called, when this surface
  // was entered to add turfs to one. A name has to be unique across the
  // campaign and not merely across this drawing session, and those turfs
  // have no card here to go red — so the collision is reported on the
  // draft, which is the half the candidate can still change.
  savedTurfNames: string[]
  team: TeamOption[]
  onSelectDraft: (clientId: string) => void
  onStartNewTurf: () => void
  onRemoveDraft: (clientId: string) => void
  // Throw away the turf still being cut — the one with no draft behind it
  // yet. Separate from `onRemoveDraft` because there is no `clientId` to
  // pass: what it discards is the drawing session itself.
  onDiscardPendingTurf: () => void
  onPickColor: (color: string) => void
  // Renames the turf under the cursor. The card for the turf still being
  // CUT reports through this too — the page holds its name as
  // `pendingName` until a third corner commits a draft to stamp it onto.
  onRename: (name: string) => void
  onAssign: (assigneeId: number | null) => void
  // Keep what this drawing session did, and hand back to the step. Blocked
  // only by a shape that will not route.
  onSave: () => void
  saveDisabled: boolean
  // Put the campaign's turfs back the way they were when the surface opened.
  onCancel: () => void
  // Whether that restore would change anything, so Cancel asks first only
  // when something is at stake.
  dirty: boolean
  // How far up the map this panel reaches, so maplibre's zoom cluster clears
  // it. Only meaningful below `lg`, where the panel is over the map.
  onMapControlsOffsetChange: (offsetPx: number | null) => void
}

// Where the map's control cluster sits while the panel is DOCKED: its
// ordinary edge gap, because the panel is beside the map there and covers
// none of it.
const DOCKED_CONTROLS_BOTTOM_PX = 16

// Whether the panel is beside the map rather than over it.
//
// `matchMedia` rather than the styleguide's `useIsMobile`, and deliberately
// so: this decides only what the panel REPORTS to the map, never what it
// renders. The arrangement stays CSS's alone, so the "assume mobile" first
// render that would flash a hook-driven layout has nothing here to flash —
// and the one frame before the effect runs reports a measurement, which is
// merely the wrong number for a frame rather than the wrong layout.
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

// Everything about WHICH turf is being cut, and what it is: the campaign's
// turfs, the selected one's colour and canvasser, and the way to start the
// next. It replaced a 56px top strip whose four control clusters had a fixed
// minimum around 480px and so could not survive a phone.
//
// The split it draws is the rule for anything added later:
//
//   Map chrome is feedback on the DRAWING GESTURE — the hint, Undo, the stop
//   count and its over-cap shake. Those stay on the map, next to the shape
//   they are about. This panel is CONFIGURATION, and none of it belongs
//   under a thumb that is trying to place a corner.
//
// One mount, two arrangements, chosen in CSS rather than by a breakpoint
// hook: `useIsMobile` defaults to `true` on first render, which would flash
// the sheet before the panel on every desktop load.
//
//   At `lg`: a flex sibling of the map column, 430px, in flow — so the map
//   SHRINKS rather than being covered. Width matches `PersonSheet`, the other
//   docked panel in this directory. Nothing is ever hidden, which makes the
//   bug recorded in this feature's AGENTS.md — a `lg:right-4 lg:w-96` card
//   that left all three zoom buttons unclickable at 1440px — impossible here
//   rather than merely avoided.
//
//   Below `lg`: a bottom sheet over the map at peek/half/full, on the same
//   `useSheetSnap` grip the walk uses. Deliberately the same gesture: a
//   canvasser who learns it on one surface has learned it on the other. No
//   scrim and no Dialog, because the map underneath has to stay drawable.
export const TurfPanel = ({
  drafts,
  active,
  pendingName,
  pendingAssigneeId,
  drawColor,
  draftStats,
  savedTurfNames,
  team,
  onSelectDraft,
  onStartNewTurf,
  onRemoveDraft,
  onDiscardPendingTurf,
  onPickColor,
  onRename,
  onAssign,
  onSave,
  saveDisabled,
  onCancel,
  dirty,
  onMapControlsOffsetChange,
}: TurfPanelProps) => {
  const { snap, cycle, gripHandlers, heightClass, sheetRef } =
    useSheetSnap('half')
  const docked = useIsDocked()
  const [discardOpen, setDiscardOpen] = useState(false)
  // Whether Save has been pressed and refused. The problems themselves are
  // NOT stored — they are derived from the drafts on every render, so
  // typing a name or drawing the missing shape clears its card's error on
  // the next frame without anything having to remember to.
  const [attemptedSave, setAttemptedSave] = useState(false)
  // Whether the candidate has said they are ready to draw. A session that
  // opens straight onto a card and a live Save asks for a boundary before
  // the map has been moved anywhere — so the panel opens on an empty state
  // whose whole job is "find the place first", and the drawing controls
  // arrive when that is answered.
  //
  // Only ever the FIRST turf. Reopening the surface on a campaign that
  // already holds turfs has nothing to introduce, and `Add turf` is the
  // gesture for every one after.
  const [started, setStarted] = useState(drafts.length > 0)
  const introducing = !started && drafts.length === 0
  // Deleting the last card hands the panel back to the empty state rather
  // than to a bare "Turfs" heading over nothing. The same press that got
  // here is the one that leaves: an emptied panel is in exactly the state
  // the empty state was written for, and the alternative is a surface whose
  // only remaining control is Cancel.
  //
  // The two removals differ only in what they are removing. A draft is the
  // last one when it is the only one AND nothing is being cut beside it —
  // `active === null` means a turf is in progress, and that card survives
  // this press.
  const removeDraft = (clientId: string) => {
    if (drafts.length === 1 && active?.clientId === clientId) setStarted(false)
    onRemoveDraft(clientId)
  }
  const discardPendingTurf = () => {
    if (drafts.length === 0) setStarted(false)
    onDiscardPendingTurf()
  }
  // A turf that EXISTS needs something to call it. A draft with no shape is
  // not a turf at all — undo below three corners blanks a draft rather than
  // deleting it (see `isDrawnTurf`), so what a candidate is left holding
  // after taking their points back is an abandoned attempt. Saving drops
  // those rather than arguing about them, which is also what stops one
  // reaching the draw step as a card with nothing in it.
  const abandoned = drafts.filter((draft) => !isDrawnTurf(draft))
  // And two turfs in one campaign cannot be called the same thing. The name
  // is how a turf is told apart everywhere it is met afterwards — the
  // outreach history, the walk header, the printed sheet, the message that
  // hands one to a volunteer — and none of those carry the colour or the
  // id that would disambiguate them. Compared trimmed and case-folded,
  // because "Ward 4" and "ward 4 " are the same turf to everyone but the
  // database.
  //
  // The saved siblings count and are not shown, so a draft can collide
  // with a turf that has no card on this panel. One wording covers both:
  // the sentence is true either way, and the card carrying it is always the
  // one that can be changed.
  const nameKey = (name: string) => name.trim().toLowerCase()
  const nameCounts = new Map<string, number>()
  for (const name of [
    ...savedTurfNames,
    ...drafts.filter(isDrawnTurf).map((draft) => draft.name),
  ]) {
    const key = nameKey(name)
    if (key === '') continue
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1)
  }
  const problemWith = (draft: TurfDraft): string | null => {
    if (!isDrawnTurf(draft)) return null
    if (draft.name.trim() === '') return 'Name this turf'
    if ((nameCounts.get(nameKey(draft.name)) ?? 0) > 1) {
      return 'Two turfs have this name. Change one.'
    }
    return null
  }
  const incomplete = drafts.filter((draft) => problemWith(draft) !== null)
  // Selecting a turf expands its card, and the controls it opens can land
  // below the fold on a short panel. `nearest` scrolls the least that makes
  // them visible, so a card already in view does not jump.
  //
  // Safe here only because the aside is `overflow-clip` rather than
  // `overflow-hidden`: the CSSOM spec treats `overflow-hidden` as a valid
  // scroll target, so this would also scroll the aside itself and take the
  // grip and the header off the top. `overflow-clip` clips the same way but
  // is excluded from that walk — the walk sheet learned this the hard way.
  const selectedCardRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    selectedCardRef.current?.scrollIntoView({ block: 'nearest' })
  }, [active?.clientId ?? 'pending'])
  // A measurement is the right answer only while the panel is OVER the map.
  // Docked, it is 986px of panel beside the map, and reporting that would
  // push the zoom cluster a thousand pixels up off the top of the screen.
  // The hook's `override` exists for exactly this asymmetry — see its
  // comment.
  useSheetControlsOffset(
    sheetRef,
    snap,
    onMapControlsOffsetChange,
    docked ? DOCKED_CONTROLS_BOTTOM_PX : undefined,
  )
  // At `peek` the sheet is the grip and the footer and nothing else, so
  // Cancel and Save stay reachable without expanding anything. The list and
  // the selected turf's settings are what peek trades away.
  //
  // No breakpoint term: the grip is `lg:hidden`, so docked there is nothing
  // that can move the snap off its `half` default and the body always shows.
  const showBody = snap !== 'peek'

  return (
    <aside
      ref={sheetRef}
      aria-label="Turfs"
      data-snap={snap}
      className={`z-20 flex flex-col overflow-clip bg-card max-lg:absolute max-lg:inset-x-0 max-lg:bottom-0 max-lg:rounded-t-2xl max-lg:border-t max-lg:border-border max-lg:shadow-lg max-lg:transition-[height] max-lg:duration-[260ms] max-lg:ease-out lg:relative lg:w-[430px] lg:shrink-0 lg:border-l lg:border-border ${heightClass} lg:h-full`}
    >
      {/* The grip, below `lg` only — at desktop the panel has no height to
          drag. Its children are centred with `mx-auto` rather than
          `items-center`, because `app/globals.css` carries an unlayered
          legacy rule that forces `display:flex; flex-direction:row` on a
          flex element with `items-center`, and unlayered CSS outranks
          `@layer utilities` — so `flex-col` AND `lg:hidden` would both
          silently lose. A grab handle on this map has already been lost to
          that rule once. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={snap !== 'peek'}
        aria-label={snap === 'full' ? 'Collapse the turfs' : 'Expand the turfs'}
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

      {/* Add turf sits in the header rather than under the list, and that
          is what keeps it reachable: the header is outside the `showBody`
          gate, so a sheet collapsed to `peek` can still start a turf. Under
          the list it also drifted further down the panel with every turf
          added — the one control whose distance from the thumb grew with
          exactly the thing that makes you want it. */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-5 pt-4 pb-3 max-lg:pt-1">
        <h2 className="text-base font-semibold">Turfs</h2>
        {/* Live even while a turf is being cut. It used to go dead there —
            the canvas draws one boundary at a time, so starting a second
            turf abandons whatever corners are down — but that put a dead
            control in the corner for the whole of the most common state on
            this surface, including the moment straight after `Draw first
            turf` when there is nothing to lose at all. What it costs is at
            most two placed corners, which Undo takes back one at a time
            anyway; what it bought was a button that looked broken.

            Absent rather than disabled before the FIRST turf: there is
            nothing to add one TO yet, and a dead control beside an empty
            state is a second thing to explain. */}
        {!introducing && (
          <Button
            type="button"
            size="small"
            variant="outline"
            onClick={onStartNewTurf}
          >
            <PlusIcon className="size-4" />
            Add turf
          </Button>
        )}
      </div>

      {showBody && (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {/* Before the first turf there is no list and no card to open —
              the one thing to do is move the map to the neighbourhood, and
              the panel says so rather than sitting empty beside a live
              Save. Pressing the CTA is what brings the card, `Add turf`
              and a live Save at once. */}
          {introducing && (
            <EmptyState
              title="No turfs yet"
              message="Navigate the map to the location you want to draw your first turf."
              action={
                <Button type="button" onClick={() => setStarted(true)}>
                  Draw the first turf
                </Button>
              }
            />
          )}
          {/* Each turf is its own card, inset from the panel edge and
              rounded, so the list reads as a set of objects you can act on
              rather than a table of rows. What makes a card fill the width
              it is given is the `block` on its `li` below — without it they
              shrink to their text, which is a different problem wearing the
              same symptom. */}
          {!introducing && (
            <ul className="flex flex-col gap-2">
              {drafts.map((draft) => {
                const selected = draft.clientId === active?.clientId
                // `block` on the `li` is not decoration. `app/globals.css`
                // forces `display: flex` on every `li` under a `[data-slot]`
                // ancestor, and this panel has one — which shrinks a single
                // child to its content width and reads as a row stopping
                // short of the panel. That file's own comment names this
                // exact symptom and prescribes an explicit display utility;
                // it lives in `@layer base` so the utility wins.
                return (
                  <li key={draft.clientId} className="block">
                    <TurfCard
                      name={draft.name}
                      color={draft.color}
                      assigneeId={draft.assigneeId}
                      selected={selected}
                      cardRef={selected ? selectedCardRef : undefined}
                      counts={
                        isDrawnTurf(draft) ? (
                          <DraftCounts
                            stats={draftStats.get(draft.clientId) ?? null}
                          />
                        ) : (
                          'Drawing'
                        )
                      }
                      team={team}
                      onSelect={() => onSelectDraft(draft.clientId)}
                      onRemove={() => removeDraft(draft.clientId)}
                      onPickColor={onPickColor}
                      onAssign={onAssign}
                      onRename={onRename}
                      error={attemptedSave ? problemWith(draft) : null}
                    />
                  </li>
                )
              })}
              {/* The turf being cut is not in `drafts` until its third corner
              lands, so it gets a card of its own rather than the list being
              empty while somebody is visibly drawing into it.

              It is the SAME card, open — not a dashed placeholder. The
              dashed row said "provisional" and then offered nothing, so
              the colour and the canvasser could only be set after three
              corners were down, and the panel visibly rearranged itself
              under the cursor at the moment they landed. This turf is the
              one being worked on by definition, which is what the open
              state means everywhere else in this list. */}
              {active === null && (
                <li className="block">
                  <TurfCard
                    name={pendingName}
                    color={drawColor}
                    assigneeId={pendingAssigneeId}
                    selected
                    cardRef={selectedCardRef}
                    counts="Drawing"
                    team={team}
                    onRemove={discardPendingTurf}
                    onPickColor={onPickColor}
                    onAssign={onAssign}
                    onRename={onRename}
                  />
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* The session's two words, in the panel rather than on the map. They
          are decisions about the CAMPAIGN — keep this work, or put it back —
          and the map's own chrome is feedback on the gesture. Pinned outside
          the scroller so a long turf list never pushes them off, and outside
          the `showBody` gate so `peek` keeps them reachable. */}
      <div className="flex shrink-0 gap-3 border-t border-border px-5 py-4">
        <Button
          type="button"
          variant="ghost"
          className="flex-1"
          onClick={() => (dirty ? setDiscardOpen(true) : onCancel())}
        >
          Cancel
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={saveDisabled}
          onClick={() => {
            // Refused rather than disabled. A dead Save button says a turf
            // is wrong without saying which one or why, and the answer is
            // per-card — so the press is what asks the question and the
            // cards are where it is answered.
            if (incomplete.length > 0) {
              setAttemptedSave(true)
              return
            }
            // Leaving with nothing drawn is a legitimate exit, and so is
            // leaving after taking every point back: both hand back to a
            // step whose own Continue is already disabled, which says so
            // once. What must not survive is the blank draft itself.
            for (const draft of abandoned) onRemoveDraft(draft.clientId)
            onSave()
          }}
        >
          Save
        </Button>
      </div>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {drafts.length === 1
                ? 'Discard this turf?'
                : `Discard ${drafts.length} turfs?`}
            </AlertDialogTitle>
            {/* Says what is lost and nothing about cost — see
                `removeTurfDialog.tsx`: the candidate is never the one
                paying, so money has no place here. Singular and plural
                follow the title, which already branches. */}
            <AlertDialogDescription>
              {drafts.length === 1
                ? 'You will have to draw it again if you change your mind.'
                : 'You will have to draw them again if you change your mind.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep drawing</AlertDialogCancel>
            {/* `variant`, never a className — see `removeTurfDialog.tsx`
              for what the className spelling leaves behind. */}
            <AlertDialogAction variant="destructive" onClick={onCancel}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}

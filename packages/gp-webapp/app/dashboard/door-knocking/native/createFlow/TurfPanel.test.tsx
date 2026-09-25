import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { TurfPanel } from './TurfPanel'
import type { TeamOption } from '../useTeamOptions'
import type { TurfDraft } from '../turfDrafts'

const draft = (over: Partial<TurfDraft> = {}): TurfDraft => ({
  clientId: 'draft-1',
  polygon: [
    [-87.66, 41.92],
    [-87.65, 41.92],
    [-87.65, 41.93],
  ],
  color: '#2563eb',
  name: 'Turf 1',
  assigneeId: null,
  ...over,
})

const stats = (people: number, households: number) => ({
  stops: households,
  people,
  households,
  partyMix: [],
  ageMix: [],
})

const TEAM: TeamOption[] = [
  { userId: 42, label: 'Alex Rivera' },
  { userId: 43, label: 'Sam Okafor' },
]

const baseProps = {
  drafts: [draft()],
  active: draft(),
  pendingName: 'Turf 2',
  pendingAssigneeId: null,
  drawColor: '#2563eb',
  draftStats: new Map([['draft-1', stats(6, 4)]]),
  savedTurfNames: [],
  team: TEAM,
  onSelectDraft: vi.fn(),
  onStartNewTurf: vi.fn(),
  onRename: vi.fn(),
  onRemoveDraft: vi.fn(),
  onDiscardPendingTurf: vi.fn(),
  onPickColor: vi.fn(),
  onAssign: vi.fn(),
  onSave: vi.fn(),
  saveDisabled: false,
  onCancel: vi.fn(),
  dirty: false,
  onMapControlsOffsetChange: vi.fn(),
}

describe('TurfPanel', () => {
  it('lists every turf with its own counts', () => {
    render(
      <TurfPanel
        {...baseProps}
        drafts={[draft(), draft({ clientId: 'draft-2', name: 'Turf 2' })]}
        draftStats={
          new Map([
            ['draft-1', stats(6, 4)],
            ['draft-2', stats(11, 8)],
          ])
        }
      />,
    )

    // Turf 1 is the open card, so its name is an input and therefore a
    // VALUE; Turf 2 is closed and is text.
    expect(screen.getByDisplayValue('Turf 1')).toBeInTheDocument()
    expect(screen.getByText('Turf 2')).toBeInTheDocument()
    // Stops, and only stops: the router's own unit, and the one the 150 cap
    // is stated in. `stats(people, households)` sets stops from households.
    expect(screen.getByText(/^4 stops/)).toBeInTheDocument()
    expect(screen.getByText(/^8 stops/)).toBeInTheDocument()
  })

  it('stops reporting a boundary that has been undone away', () => {
    // Reported from the app: draw a turf, undo the corners back below
    // three, and the card still read "43 stops" about a shape that was no
    // longer on the map. A draft with no polygon is a turf still being
    // drawn, and says so.
    render(
      <TurfPanel
        {...baseProps}
        drafts={[draft({ polygon: [] })]}
        active={draft({ polygon: [] })}
      />,
    )

    expect(screen.queryByText(/stops/)).toBeNull()
    expect(screen.getByText('Drawing')).toBeInTheDocument()
  })

  it('keeps the turf’s colour and canvasser through that undo', () => {
    // The draft is kept rather than deleted precisely so Undo cannot throw
    // away work the candidate has already done. The card stays selected and
    // its controls stay on the turf.
    render(
      <TurfPanel
        {...baseProps}
        drafts={[draft({ polygon: [], color: '#16a34a', assigneeId: 42 })]}
        active={draft({ polygon: [], color: '#16a34a', assigneeId: 42 })}
      />,
    )

    expect(screen.getByRole('button', { name: 'Green' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Alex Rivera' })).toBeVisible()
  })

  it('selects a turf from its row', () => {
    const onSelectDraft = vi.fn()
    render(
      <TurfPanel
        {...baseProps}
        active={null}
        drafts={[draft(), draft({ clientId: 'draft-2', name: 'Turf 2' })]}
        onSelectDraft={onSelectDraft}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^Turf 2/ }))
    expect(onSelectDraft).toHaveBeenCalledWith('draft-2')
  })

  it('writes a picked colour through one handler', () => {
    const onPickColor = vi.fn()
    render(<TurfPanel {...baseProps} onPickColor={onPickColor} />)

    fireEvent.click(screen.getByRole('button', { name: 'Green' }))

    // One handler, because a colour has to reach the live ring AND the draft
    // — the page holds both, and a hue written to only one of them survives
    // until the candidate switches turfs.
    expect(onPickColor).toHaveBeenCalledWith('#16a34a')
  })

  it('opens the turf being cut before its first corner lands', () => {
    // It is the same card as every other turf's, open — not a dashed
    // placeholder that offers nothing. The colour and the canvasser can be
    // set while the shape is still being drawn, and the panel does not
    // rearrange itself under the cursor at the moment a third corner lands.
    const onPickColor = vi.fn()
    render(
      <TurfPanel
        {...baseProps}
        drafts={[]}
        active={null}
        onPickColor={onPickColor}
      />,
    )
    // The pending card lives behind the empty state now.
    const cta = screen.queryByRole('button', { name: /Draw the first turf/ })
    if (cta) fireEvent.click(cta)

    // The card being cut is open, so its name is an input and therefore a
    // VALUE rather than text.
    expect(screen.getByDisplayValue('Turf 2')).toBeInTheDocument()
    expect(screen.getByText('Drawing')).toBeInTheDocument()
    expect(screen.getByText('Who walks this turf')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Green' }))
    expect(onPickColor).toHaveBeenCalledWith('#16a34a')
  })

  it('reads back a canvasser picked before the turf exists', () => {
    // The page holds the answer until there is a draft to stamp it onto, so
    // the card has to read it back from `pendingAssigneeId` rather than from
    // a draft that is not there yet.
    render(
      <TurfPanel
        {...baseProps}
        drafts={[]}
        active={null}
        pendingAssigneeId={42}
      />,
    )
    // The pending card lives behind the empty state now.
    const cta = screen.queryByRole('button', { name: /Draw the first turf/ })
    if (cta) fireEvent.click(cta)

    expect(screen.getByRole('button', { name: 'Alex Rivera' })).toBeVisible()
  })

  it('offers no way to select the turf being cut, but throws it away', async () => {
    // Nothing to select: it is already the open one, so a button that
    // selects it is a target with no outcome. Delete is a different
    // question — Undo takes back one corner at a time and cannot take back
    // the turf, so without this a candidate who started one by mistake has
    // nothing to press.
    const onDiscardPendingTurf = vi.fn()
    render(
      <TurfPanel
        {...baseProps}
        drafts={[]}
        active={null}
        onDiscardPendingTurf={onDiscardPendingTurf}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Draw the first turf/ }))

    expect(screen.queryByRole('button', { name: /^Turf 2/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Turf 2' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(onDiscardPendingTurf).toHaveBeenCalled()

    // And the panel is empty again, so it says what the empty panel says
    // rather than putting the card straight back.
    expect(
      screen.getByRole('button', { name: /Draw the first turf/ }),
    ).toBeInTheDocument()
  })

  it('returns to the empty state when the last turf is deleted', async () => {
    // The press that empties the panel is the one that leaves: an emptied
    // panel is in exactly the state the empty state was written for, and
    // the alternative is a "Turfs" heading over nothing with Cancel as the
    // only live control.
    const onRemoveDraft = vi.fn()
    const { rerender } = render(
      <TurfPanel {...baseProps} onRemoveDraft={onRemoveDraft} />,
    )

    expect(
      screen.queryByRole('button', { name: /Draw the first turf/ }),
    ).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Turf 1' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(onRemoveDraft).toHaveBeenCalledWith('draft-1')

    // The page owns the list, so it is the one that drops the draft and
    // hands back an empty campaign with a fresh drawing session behind it.
    // Without the reset that is the pending card's cue to appear.
    rerender(
      <TurfPanel
        {...baseProps}
        drafts={[]}
        active={null}
        onRemoveDraft={onRemoveDraft}
      />,
    )
    expect(
      screen.getByRole('button', { name: /Draw the first turf/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add turf/ })).toBeNull()
  })

  it('names delete after the turf, or after no turf at all', async () => {
    // "Delete ?" is what the unnamed case used to read, and the turf being
    // cut can now be thrown away before it has either a name or a third
    // corner.
    render(
      <TurfPanel {...baseProps} drafts={[]} active={null} pendingName="" />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Draw the first turf/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete this turf' }))
    expect(await screen.findByText('Delete this turf?')).toBeInTheDocument()
  })

  it('assigns the selected turf, and can take it back', async () => {
    const user = userEvent.setup()
    const onAssign = vi.fn()
    const { rerender } = render(
      <TurfPanel {...baseProps} onAssign={onAssign} />,
    )

    await user.click(screen.getByRole('button', { name: 'Unassigned' }))
    await user.click(screen.getByRole('menuitem', { name: 'Alex Rivera' }))
    expect(onAssign).toHaveBeenCalledWith(42)

    rerender(
      <TurfPanel
        {...baseProps}
        active={draft({ assigneeId: 42 })}
        drafts={[draft({ assigneeId: 42 })]}
        onAssign={onAssign}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Alex Rivera' }))
    await user.click(screen.getByRole('menuitem', { name: 'Unassign' }))
    expect(onAssign).toHaveBeenLastCalledWith(null)
  })

  it('hides the assignee control for an org with no team', () => {
    // Not disabled: an org with nobody on it has nobody to assign to, and a
    // control whose only outcome is finding that out is worse than none. A
    // roster that failed to load lands here too.
    render(<TurfPanel {...baseProps} team={[]} />)

    expect(screen.queryByText('Who walks this turf')).toBeNull()
  })

  it('starts another turf while one is still being cut', () => {
    // Add turf used to go dead here, on the argument that the canvas draws
    // one boundary at a time so a second press abandons the corners
    // already down. That put a dead control in the corner for the whole of
    // the most common state on this surface — including the moment
    // straight after `Draw the first turf`, when there is nothing to lose.
    const onStartNewTurf = vi.fn()
    render(
      <TurfPanel
        {...baseProps}
        drafts={[]}
        active={null}
        onStartNewTurf={onStartNewTurf}
      />,
    )
    // No drafts is the panel's empty state, which offers neither Add turf
    // nor a card until the candidate says they are ready to draw.
    fireEvent.click(screen.getByRole('button', { name: /Draw the first turf/ }))

    fireEvent.click(screen.getByRole('button', { name: /Add turf/ }))
    expect(onStartNewTurf).toHaveBeenCalled()
  })

  it('starts the next turf and drops one', () => {
    const onStartNewTurf = vi.fn()
    const onRemoveDraft = vi.fn()
    render(
      <TurfPanel
        {...baseProps}
        onStartNewTurf={onStartNewTurf}
        onRemoveDraft={onRemoveDraft}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Add turf/ }))
    expect(onStartNewTurf).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Turf 1' }))
    expect(onRemoveDraft).not.toHaveBeenCalled()
  })

  it('asks before removing a turf, and drops it on the answer', async () => {
    // Drawing a turf is corner-by-corner work over a neighbourhood and
    // there is no undo for the turf itself, so the trash icon — a thumb's
    // width from the row that names it — asks first.
    const onRemoveDraft = vi.fn()
    render(<TurfPanel {...baseProps} onRemoveDraft={onRemoveDraft} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Turf 1' }))
    expect(await screen.findByText('Delete Turf 1?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Keep turf' }))
    expect(onRemoveDraft).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete Turf 1' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(onRemoveDraft).toHaveBeenCalledWith('draft-1')
  })

  it('prints the canvasser left of the count, with a mid dot between', () => {
    // One line: the name, then who walks it, then what it is worth. The
    // count is last so its right edge lands in the same column on every
    // row, which is what `tabular-nums` is for.
    render(
      <TurfPanel
        {...baseProps}
        drafts={[draft({ assigneeId: 42 })]}
        active={null}
      />,
    )
    // The pending card lives behind the empty state now.
    const cta = screen.queryByRole('button', { name: /Draw the first turf/ })
    if (cta) fireEvent.click(cta)

    // The spacing is CSS, so the order is what the text content shows.
    const row = screen.getByRole('button', { name: /^Turf 1/ })
    expect(row).toHaveTextContent('Turf 1Alex Rivera·4 stops')
  })

  it('refuses to save two turfs with one name, and reddens both', async () => {
    // The name is how a turf is told apart everywhere it is met afterwards
    // — outreach history, the walk header, the printed sheet — and none of
    // those carry the colour or the id that would disambiguate them.
    const onSave = vi.fn()
    const twins = [
      draft({ name: 'Ward 4' }),
      // Trimmed and case-folded: the same turf to everyone but the
      // database.
      draft({ clientId: 'draft-2', name: 'ward 4 ' }),
    ]
    render(
      <TurfPanel
        {...baseProps}
        drafts={twins}
        draftStats={
          new Map([
            ['draft-1', stats(6, 4)],
            ['draft-2', stats(11, 8)],
          ])
        }
        onSave={onSave}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).not.toHaveBeenCalled()
    // BOTH, because either one is the one to change and a single red card
    // would be picking for them.
    const alerts = await screen.findAllByRole('alert')
    expect(alerts).toHaveLength(2)
    for (const alert of alerts) {
      expect(alert).toHaveTextContent('Two turfs have this name. Change one.')
    }
  })

  it('counts the turfs this campaign already holds as names taken', async () => {
    // Entered through "Draw more turfs", the campaign's saved turfs are not
    // on this panel and have no card to redden — so the collision is
    // reported on the draft, which is the half that can still be changed.
    const onSave = vi.fn()
    const { rerender } = render(
      <TurfPanel
        {...baseProps}
        savedTurfNames={['Downtown', 'Ward 4']}
        onSave={onSave}
      />,
    )

    // `Turf 1` clashes with neither, so the press goes through.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledTimes(1)

    onSave.mockClear()
    rerender(
      <TurfPanel
        {...baseProps}
        drafts={[draft({ name: 'Downtown' })]}
        savedTurfNames={['Downtown', 'Ward 4']}
        onSave={onSave}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).not.toHaveBeenCalled()
    // One card, because only one of the two is on this panel.
    const alerts = await screen.findAllByRole('alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toHaveTextContent('Two turfs have this name. Change one.')
  })

  it('clears the duplicate on the next frame, with no second press', async () => {
    // Derived from the drafts on every render rather than stored when the
    // press was refused, so fixing one card clears its own error without
    // anything having to remember to.
    const onSave = vi.fn()
    const { rerender } = render(
      <TurfPanel
        {...baseProps}
        drafts={[
          draft({ name: 'Ward 4' }),
          draft({ clientId: 'draft-2', name: 'Ward 4' }),
        ]}
        onSave={onSave}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findAllByRole('alert')).toHaveLength(2)

    rerender(
      <TurfPanel
        {...baseProps}
        drafts={[
          draft({ name: 'Ward 4' }),
          draft({ clientId: 'draft-2', name: 'Ward 5' }),
        ]}
        onSave={onSave}
      />,
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('gates Save only on a shape that will not route', () => {
    // Deliberately NOT gated on having a turf, nor on the empty state.
    // Leaving a surface you are standing on is never the thing to block: a
    // candidate who opened the map and decided not to cut anything hands
    // back to a step whose own Continue is already disabled, which says so
    // once.
    const onSave = vi.fn()
    const { rerender } = render(
      <TurfPanel {...baseProps} drafts={[]} active={null} onSave={onSave} />,
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()

    rerender(<TurfPanel {...baseProps} saveDisabled onSave={onSave} />)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    rerender(<TurfPanel {...baseProps} onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalled()
  })

  it('asks before discarding, and only when the session changed something', async () => {
    // Cancel is the only destructive control here, and it asks first only
    // when something would actually be lost. The button it replaced carried
    // a prompt that fired on every press with any vertices down — for a
    // gesture that discarded nothing — and it was removed for crying wolf.
    const onCancel = vi.fn()
    const { rerender } = render(
      <TurfPanel {...baseProps} dirty={false} onCancel={onCancel} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Discard/)).toBeNull()

    onCancel.mockClear()
    rerender(<TurfPanel {...baseProps} dirty onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    // Held until the confirm is answered, and the confirm names what is at
    // stake rather than "your changes".
    expect(onCancel).not.toHaveBeenCalled()
    expect(await screen.findByText('Discard this turf?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('keeps Cancel and Save reachable at every snap', () => {
    // `peek` trades away the list and the selected turf's settings, never
    // the two words that end the session — a sheet you have to expand
    // before you can leave it is a trap.
    render(<TurfPanel {...baseProps} />)

    const grip = screen.getByRole('button', { name: /Collapse|Expand/ })
    fireEvent.keyDown(grip, { key: 'Enter' })

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('reports how far up the map it reaches', () => {
    // The map's zoom cluster has to clear the sheet below `lg`, and only the
    // sheet knows its own height. Same contract the walk's sheet has.
    const onMapControlsOffsetChange = vi.fn()
    render(
      <TurfPanel
        {...baseProps}
        onMapControlsOffsetChange={onMapControlsOffsetChange}
      />,
    )

    expect(onMapControlsOffsetChange).toHaveBeenCalled()
  })
})

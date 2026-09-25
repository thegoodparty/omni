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
  team: TEAM,
  onSelectDraft: vi.fn(),
  onStartNewTurf: vi.fn(),
  onRename: vi.fn(),
  onRemoveDraft: vi.fn(),
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
    const cta = screen.queryByRole('button', { name: /Draw first turf/ })
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
    const cta = screen.queryByRole('button', { name: /Draw first turf/ })
    if (cta) fireEvent.click(cta)

    expect(screen.getByRole('button', { name: 'Alex Rivera' })).toBeVisible()
  })

  it('offers no way to select or remove the turf being cut', () => {
    // It is already the open one, and Undo is the gesture that takes its
    // corners back — a Remove here would be a control for a draft that does
    // not exist.
    render(<TurfPanel {...baseProps} drafts={[]} active={null} />)

    expect(screen.queryByRole('button', { name: /^Turf 2/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull()
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

  it('will not start a second turf while one is still being cut', () => {
    // The canvas draws one boundary at a time, so a second Add turf would
    // abandon the corners already placed without saying so. A null active
    // turf IS that state: a turf becomes a draft on its third corner.
    const onStartNewTurf = vi.fn()
    const { rerender } = render(
      <TurfPanel
        {...baseProps}
        drafts={[]}
        active={null}
        onStartNewTurf={onStartNewTurf}
      />,
    )
    // No drafts is the panel's empty state, which offers neither Add turf
    // nor a card until the candidate says they are ready to draw.
    fireEvent.click(screen.getByRole('button', { name: /Draw first turf/ }))
    expect(screen.getByRole('button', { name: /Add turf/ })).toBeDisabled()

    // Finished — the turf is a draft now, so the next one can start.
    rerender(<TurfPanel {...baseProps} onStartNewTurf={onStartNewTurf} />)
    expect(screen.getByRole('button', { name: /Add turf/ })).toBeEnabled()
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
    const cta = screen.queryByRole('button', { name: /Draw first turf/ })
    if (cta) fireEvent.click(cta)

    // The spacing is CSS, so the order is what the text content shows.
    const row = screen.getByRole('button', { name: /^Turf 1/ })
    expect(row).toHaveTextContent('Turf 1Alex Rivera·4 stops')
  })

  it('gates Save on the empty state and on a shape that will not route', () => {
    // Dead on the empty state, which is a change from the old rule that
    // Save was never blocked by having no turfs. That rule existed so
    // Cancel could not become the only live control on a surface somebody
    // is standing on — the empty state answers that instead, since it
    // carries its own CTA and Cancel is beside it.
    const onSave = vi.fn()
    const { rerender } = render(
      <TurfPanel {...baseProps} drafts={[]} active={null} onSave={onSave} />,
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    // Saying you are ready to draw brings it to life, along with the card
    // and Add turf.
    fireEvent.click(screen.getByRole('button', { name: /Draw first turf/ }))
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

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { DrawToolbar, type TeamOption } from './DrawToolbar'
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

const TEAM: TeamOption[] = [
  { userId: 42, label: 'Alex Rivera' },
  { userId: 43, label: 'Sam Okafor' },
]

const baseProps = {
  drafts: [draft()],
  active: draft(),
  pendingName: 'Turf 2',
  drawColor: '#2563eb',
  onSelectDraft: vi.fn(),
  onStartNewTurf: vi.fn(),
  onPickColor: vi.fn(),
  onAssign: vi.fn(),
  team: TEAM,
}

describe('DrawToolbar', () => {
  it('names the turf being cut, and the one coming before it exists', () => {
    const { rerender } = render(<DrawToolbar {...baseProps} />)
    expect(screen.getByText('Turf 1')).toBeInTheDocument()

    // Before the third corner lands there is no draft yet, so the chip names
    // the turf that is COMING rather than going blank or naming the last one.
    rerender(<DrawToolbar {...baseProps} active={null} />)
    expect(screen.getByText('Turf 2')).toBeInTheDocument()
  })

  it('writes a picked colour back through one handler', () => {
    const onPickColor = vi.fn()
    render(<DrawToolbar {...baseProps} onPickColor={onPickColor} />)

    fireEvent.click(screen.getByRole('button', { name: 'Turf color' }))
    fireEvent.click(screen.getByRole('button', { name: 'Green' }))

    // One handler, because a colour has to reach the live ring AND the draft
    // — the page holds both, and a hue written to only one of them survives
    // until the candidate switches turfs.
    expect(onPickColor).toHaveBeenCalledWith('#16a34a')
  })

  it('offers every turf cut so far, and a way to start the next', async () => {
    const user = userEvent.setup()
    const onSelectDraft = vi.fn()
    const onStartNewTurf = vi.fn()
    render(
      <DrawToolbar
        {...baseProps}
        drafts={[draft(), draft({ clientId: 'draft-2', name: 'Turf 2' })]}
        onSelectDraft={onSelectDraft}
        onStartNewTurf={onStartNewTurf}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Turf 1/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Turf 2' }))
    expect(onSelectDraft).toHaveBeenCalledWith('draft-2')

    // The design's own affordance sits on the right of the strip; the menu
    // carries it too, because that is where a candidate already is when they
    // have just finished looking at what they cut.
    await user.click(screen.getByRole('button', { name: /New turf/ }))
    expect(onStartNewTurf).toHaveBeenCalled()
  })

  it('assigns the turf under the cursor, and can take it back', async () => {
    const user = userEvent.setup()
    const onAssign = vi.fn()
    const { rerender } = render(
      <DrawToolbar {...baseProps} onAssign={onAssign} />,
    )

    await user.click(screen.getByRole('button', { name: /Assign/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Alex Rivera' }))
    expect(onAssign).toHaveBeenCalledWith(42)

    rerender(
      <DrawToolbar
        {...baseProps}
        active={draft({ assigneeId: 42 })}
        onAssign={onAssign}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Alex Rivera/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Unassign' }))
    expect(onAssign).toHaveBeenLastCalledWith(null)
  })

  it('hides the assignee control for an org with no team', () => {
    // Not disabled: an org with nobody on it has nobody to assign to, and a
    // control whose only outcome is finding that out is worse than none. The
    // roster failing to load lands here too.
    render(<DrawToolbar {...baseProps} team={[]} />)

    expect(screen.queryByRole('button', { name: /Assign/ })).toBeNull()
  })

  it('will not assign a turf that does not exist yet', () => {
    render(<DrawToolbar {...baseProps} active={null} />)

    // Three corners make a turf. Before that there is no draft to hang a
    // canvasser off, so the control is dead rather than silently dropping
    // the pick.
    expect(screen.getByRole('button', { name: /Assign/ })).toBeDisabled()
  })
})

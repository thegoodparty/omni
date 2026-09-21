import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { getContactsLabels } from 'app/dashboard/shared/contactsLabels'
import ListBoundaryOverlay from './ListBoundaryOverlay'

vi.mock('./BoundaryDrawPanel', () => ({
  __esModule: true,
  default: function BoundaryDrawPanelStub() {
    return (
      <div data-testid="draw-panel">
        <button type="button">Undo last point</button>
      </div>
    )
  },
}))

const LABELS = getContactsLabels(false)

const renderOverlay = (over: Partial<{ onCancel: () => void }> = {}) =>
  render(
    <>
      {/* Stands in for the page behind the overlay — on the chat surface
          this is other maps' draw buttons, which remount the overlay and
          discard the ring being drawn. */}
      <button type="button">Behind the overlay</button>
      <ListBoundaryOverlay
        people={[]}
        truncated={false}
        initialRing={[]}
        labels={LABELS}
        isSaving={false}
        onCancel={over.onCancel ?? vi.fn()}
        onSave={vi.fn()}
      />
    </>,
  )

describe('ListBoundaryOverlay focus handling', () => {
  it('announces itself as a modal dialog', async () => {
    renderOverlay()

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName()
  })

  it('moves focus into the overlay on open', async () => {
    renderOverlay()

    expect(await screen.findByRole('dialog')).toHaveFocus()
  })

  // It covers the viewport with an opaque background, so nothing behind it
  // is clickable — but Tab does not care what is painted on top.
  it('keeps Tab inside rather than walking onto the page behind', async () => {
    const user = userEvent.setup()
    renderOverlay()
    await screen.findByRole('dialog')

    const behind = screen.getByRole('button', { name: 'Behind the overlay' })
    for (let i = 0; i < 8; i++) {
      await user.tab()
      expect(behind).not.toHaveFocus()
    }
  })

  it('wraps backwards too, not only off the end', async () => {
    const user = userEvent.setup()
    renderOverlay()
    await screen.findByRole('dialog')

    const behind = screen.getByRole('button', { name: 'Behind the overlay' })
    for (let i = 0; i < 4; i++) {
      await user.tab({ shift: true })
      expect(behind).not.toHaveFocus()
    }
  })

  // Escape is Cancel, which is a labelled button in the same view doing
  // exactly this — not the silent discard the remount cases were.
  it('cancels on Escape', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    renderOverlay({ onCancel })
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('returns focus to whatever opened it', async () => {
    render(<button type="button">Draw an area</button>)
    const opener = screen.getByRole('button', { name: 'Draw an area' })
    opener.focus()
    expect(opener).toHaveFocus()

    const { unmount } = render(
      <ListBoundaryOverlay
        people={[]}
        truncated={false}
        initialRing={[]}
        labels={LABELS}
        isSaving={false}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    )
    await screen.findByRole('dialog')
    expect(opener).not.toHaveFocus()

    unmount()

    await vi.waitFor(() => expect(opener).toHaveFocus())
  })
})

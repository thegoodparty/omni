import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { getContactsLabels } from 'app/dashboard/shared/contactsLabels'
import type { SegmentResponse } from '../shared/contacts-types'
import ListBoundaryOverlay, {
  savedListAudienceFilters,
} from './ListBoundaryOverlay'

vi.mock('../wizard/useFilterPoints', () => ({
  useFilterPoints: () => ({
    points: [],
    truncated: false,
    isLoading: false,
    isError: false,
  }),
}))

const SEGMENT = { id: 7, name: 'Seniors' } as SegmentResponse

vi.mock('./ContactListMap', () => ({
  __esModule: true,
  default: function ContactListMapStub() {
    return <div data-testid="contact-map" />
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
        segment={SEGMENT}
        initialShapes={[]}
        labels={LABELS}
        isSaving={false}
        onCancel={over.onCancel ?? vi.fn()}
        onSave={vi.fn()}
      />
    </>,
  )

describe('ListBoundaryOverlay focus handling', () => {
  // Radix hides the rest of the tree with aria-hidden rather than setting
  // aria-modal, which is the stronger of the two — some assistive tech
  // ignores aria-modal outright. Asserted as the behaviour it produces, not
  // as a particular attribute, so the platform component is free to change
  // how it achieves it.
  it('announces itself as a dialog and hides the page behind it', async () => {
    renderOverlay()

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName()
    expect(
      screen.queryByRole('button', { name: 'Behind the overlay' }),
    ).not.toBeInTheDocument()
  })

  // Somewhere inside, not the wrapper specifically — Radix decides where,
  // and pinning its choice would make this a test of Radix rather than of
  // the thing that matters, which is that focus left the page behind.
  it('moves focus into the overlay on open', async () => {
    renderOverlay()
    const dialog = await screen.findByRole('dialog')

    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  // It covers the viewport with an opaque background, so nothing behind it
  // is clickable — but Tab does not care what is painted on top, and the
  // page behind holds other maps' draw buttons, which remount this overlay
  // and discard the ring being drawn.
  it('keeps Tab inside, in both directions', async () => {
    const user = userEvent.setup()
    renderOverlay()
    const dialog = await screen.findByRole('dialog')

    for (let i = 0; i < 8; i++) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    for (let i = 0; i < 4; i++) {
      await user.tab({ shift: true })
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
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
    const user = userEvent.setup()

    // A real open/close cycle in one tree, because that is what Radix
    // restores against — two independent render() calls give it nothing to
    // hand focus back to.
    const Harness = () => {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Draw shapes
          </button>
          {open && (
            <ListBoundaryOverlay
              segment={SEGMENT}
              initialShapes={[]}
              labels={LABELS}
              isSaving={false}
              onCancel={() => setOpen(false)}
              onSave={vi.fn()}
            />
          )}
        </>
      )
    }
    render(<Harness />)

    const opener = screen.getByRole('button', { name: 'Draw shapes' })
    await user.click(opener)
    await screen.findByRole('dialog')
    expect(opener).not.toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await vi.waitFor(() => expect(opener).toHaveFocus())
  })
})

// The members of a list with a boundary are already cut down to its shapes,
// so drawing on them would hide everyone a new shape could add. The surface
// draws the list's criteria instead, with the shape taken off.
describe('savedListAudienceFilters', () => {
  it('keeps every criterion and drops the boundary', () => {
    const filters = savedListAudienceFilters({
      id: 7,
      name: 'Seniors',
      age65Plus: true,
      followUpRequested: true,
      supportStatus: ['supporter'],
      geoPoly: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
      },
      geoPolyLabels: [{ name: 'Downtown', color: '#2563eb' }],
      activityConditions: [
        {
          id: 3,
          voterFileFilterId: 7,
          outreachType: 'text',
          outreachId: 12,
          actions: ['responded'],
        },
      ],
    } as unknown as SegmentResponse)

    expect(filters).toMatchObject({
      age65Plus: true,
      followUpRequested: true,
      supportStatus: ['supporter'],
      activityConditions: [
        { outreachType: 'text', outreachId: 12, actions: ['responded'] },
      ],
    })
    expect(filters).not.toHaveProperty('geoPoly')
    expect(filters).not.toHaveProperty('geoPolyLabels')
  })
})

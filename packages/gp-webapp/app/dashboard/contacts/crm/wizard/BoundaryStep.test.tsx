import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { getContactsLabels } from 'app/dashboard/shared/contactsLabels'
import type { ListShape } from 'app/dashboard/shared/listShapes'
import type { PolygonRing } from 'app/dashboard/shared/ringGeometry'
import BoundaryStep from './BoundaryStep'

const TAPS: PolygonRing = [
  [-85.62, 44.75],
  [-85.6, 44.75],
  [-85.61, 44.77],
]

// deck.gl and maplibre don't run in jsdom. The stub offers a tap per
// scripted corner, appended to whatever ring it was handed — so three taps
// cut one shape in whichever shape the surface has under the cursor.
vi.mock('../map/ContactListMap', () => ({
  __esModule: true,
  default: function ContactListMapStub({
    drawRing,
    drawColor,
    onDrawRingChange,
  }: {
    drawRing?: PolygonRing
    drawColor?: string
    onDrawRingChange?: (ring: PolygonRing) => void
  }) {
    return (
      <div data-testid="contact-map-stub" data-draw-color={drawColor ?? ''}>
        {onDrawRingChange &&
          TAPS.map((tap, index) => (
            <button
              key={index}
              type="button"
              onClick={() => onDrawRingChange([...(drawRing ?? []), tap])}
            >
              {`place point ${index + 1}`}
            </button>
          ))}
      </div>
    )
  },
}))

vi.mock('./useFilterPoints', () => ({
  useFilterPoints: () => ({
    points: [
      { id: '1', lat: 44.76, lng: -85.61 },
      { id: '2', lat: 44.9, lng: -85.9 },
    ],
    truncated: false,
    isLoading: false,
    isError: false,
  }),
}))

const LABELS = getContactsLabels(false)

const Harness = ({
  onShapesChange,
  initial = [],
}: {
  onShapesChange: (s: ListShape[]) => void
  initial?: ListShape[]
}) => {
  const [shapes, setShapes] = useState<ListShape[]>(initial)
  return (
    <BoundaryStep
      shapes={shapes}
      onShapesChange={(next) => {
        setShapes(next)
        onShapesChange(next)
      }}
      labels={LABELS}
      filters={{}}
      count={120}
      audienceEmpty={false}
      isCounting={false}
      isError={false}
      errorMessage={undefined}
      enabled
    />
  )
}

const DOWNTOWN: ListShape = { name: 'Downtown', color: '#2563eb', ring: TAPS }

const cutOneShape = async (user: ReturnType<typeof userEvent.setup>) => {
  for (const label of ['place point 1', 'place point 2', 'place point 3']) {
    await user.click(await screen.findByRole('button', { name: label }))
  }
}

describe('BoundaryStep — shapes are cut full-screen, the door-knocking way', () => {
  it('opens the drawing surface on an empty state', async () => {
    const user = userEvent.setup()
    render(<Harness onShapesChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Draw shapes' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('No shapes yet')).toBeInTheDocument()
  })

  // A shape's name is set on the surface that draws it, and reaches the
  // wizard with its ring on Save and not before.
  it('names a shape and hands it back only when the surface saves', async () => {
    const user = userEvent.setup()
    const onShapesChange = vi.fn()
    render(<Harness onShapesChange={onShapesChange} />)

    await user.click(screen.getByRole('button', { name: 'Draw shapes' }))
    await cutOneShape(user)
    const nameInput = screen.getByRole('textbox', { name: 'Shape name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Downtown{Enter}')
    expect(onShapesChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onShapesChange).toHaveBeenCalledWith([DOWNTOWN])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Downtown')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Draw another shape' }),
    ).toBeInTheDocument()
  })

  it('opens on a fresh shape in the next colour when adding another', async () => {
    const user = userEvent.setup()
    const onShapesChange = vi.fn()
    render(<Harness onShapesChange={onShapesChange} initial={[DOWNTOWN]} />)

    await user.click(screen.getByRole('button', { name: 'Draw another shape' }))
    await cutOneShape(user)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onShapesChange).toHaveBeenCalledWith([
      DOWNTOWN,
      { name: 'Shape 1', color: '#16a34a', ring: TAPS },
    ])
  })

  it('reopens the map on the shape a card asks to edit', async () => {
    const user = userEvent.setup()
    render(<Harness onShapesChange={vi.fn()} initial={[DOWNTOWN]} />)

    await user.click(
      screen.getByRole('button', { name: 'Options for Downtown' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))

    await screen.findByRole('dialog')
    expect(screen.getByRole('textbox', { name: 'Shape name' })).toHaveValue(
      'Downtown',
    )
    expect(screen.getByTestId('contact-map-stub')).toHaveAttribute(
      'data-draw-color',
      '#2563eb',
    )
  })

  it('deletes a shape from its card after a confirm', async () => {
    const user = userEvent.setup()
    const onShapesChange = vi.fn()
    render(<Harness onShapesChange={onShapesChange} initial={[DOWNTOWN]} />)

    await user.click(
      screen.getByRole('button', { name: 'Options for Downtown' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    expect(onShapesChange).toHaveBeenCalledWith([])
  })

  it('discards what was drawn on Cancel', async () => {
    const user = userEvent.setup()
    const onShapesChange = vi.fn()
    render(<Harness onShapesChange={onShapesChange} />)

    await user.click(screen.getByRole('button', { name: 'Draw shapes' }))
    await user.click(
      await screen.findByRole('button', { name: 'place point 1' }),
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onShapesChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

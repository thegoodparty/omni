import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { getContactsLabels } from 'app/dashboard/shared/contactsLabels'
import type { PolygonRing } from 'app/dashboard/shared/ringGeometry'
import BoundaryStep from './BoundaryStep'

const TAPS: PolygonRing = [
  [-85.62, 44.75],
  [-85.6, 44.75],
  [-85.61, 44.77],
]

// deck.gl and maplibre don't run in jsdom. The stub reports whether it was
// handed a writer, and offers a tap per scripted corner only when it was —
// so a query for "place point 1" can only ever reach the drawing surface.
vi.mock('../map/ContactListMap', () => ({
  __esModule: true,
  default: function ContactListMapStub({
    contactPoints,
    drawRing,
    otherRings,
    onDrawRingChange,
  }: {
    contactPoints?: unknown[]
    drawRing?: PolygonRing
    otherRings?: PolygonRing[]
    onDrawRingChange?: (ring: PolygonRing) => void
  }) {
    return (
      <div
        data-testid="contact-map-stub"
        data-points={(contactPoints ?? []).length}
        data-ring={JSON.stringify(drawRing ?? [])}
        data-other-rings={JSON.stringify(otherRings ?? [])}
        data-draw-enabled={String(Boolean(onDrawRingChange))}
      >
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
  onRingsChange,
}: {
  onRingsChange: (r: PolygonRing[]) => void
}) => {
  const [rings, setRings] = useState<PolygonRing[]>([])
  return (
    <BoundaryStep
      rings={rings}
      onRingsChange={(next) => {
        setRings(next)
        onRingsChange(next)
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

describe('BoundaryStep — the shape is cut full-screen', () => {
  it('shows a read-only preview until the CTA opens the drawing surface', async () => {
    const user = userEvent.setup()
    render(<Harness onRingsChange={vi.fn()} />)

    expect(await screen.findByTestId('contact-map-stub')).toHaveAttribute(
      'data-draw-enabled',
      'false',
    )

    await user.click(screen.getByRole('button', { name: 'Draw an area' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    const maps = screen.getAllByTestId('contact-map-stub')
    expect(
      maps.some((map) => map.getAttribute('data-draw-enabled') === 'true'),
    ).toBe(true)
  })

  // The ring reaches the wizard on Save and not before, so a shape abandoned
  // half-drawn leaves the step exactly as it was.
  it('hands the ring back only when the overlay saves', async () => {
    const user = userEvent.setup()
    const onRingChange = vi.fn()
    render(<Harness onRingsChange={onRingChange} />)

    await user.click(screen.getByRole('button', { name: 'Draw an area' }))
    for (const label of ['place point 1', 'place point 2', 'place point 3']) {
      await user.click(await screen.findByRole('button', { name: label }))
    }
    expect(onRingChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onRingChange).toHaveBeenCalledWith([TAPS])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('contact-map-stub')).toHaveAttribute(
      'data-other-rings',
      JSON.stringify([TAPS]),
    )
    expect(
      screen.getByRole('button', { name: 'Edit area' }),
    ).toBeInTheDocument()
  })

  it('discards the ring on Cancel', async () => {
    const user = userEvent.setup()
    const onRingChange = vi.fn()
    render(<Harness onRingsChange={onRingChange} />)

    await user.click(screen.getByRole('button', { name: 'Draw an area' }))
    await user.click(
      await screen.findByRole('button', { name: 'place point 1' }),
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onRingChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('contact-map-stub')).toHaveAttribute(
      'data-other-rings',
      '[]',
    )
  })
})

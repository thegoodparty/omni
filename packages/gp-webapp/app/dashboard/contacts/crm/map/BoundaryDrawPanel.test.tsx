import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PolygonRing } from 'app/dashboard/shared/ringGeometry'
import BoundaryDrawPanel from './BoundaryDrawPanel'

// maplibre touches `window` at module scope and draws nothing jsdom can
// read, so the canvas is stubbed the way every other suite here stubs it.
vi.mock('./ContactListMap', () => ({
  __esModule: true,
  default: function ContactListMapStub({
    drawRing,
    otherRings,
  }: {
    drawRing?: PolygonRing
    otherRings?: PolygonRing[]
  }) {
    return (
      <div
        data-testid="contact-map-stub"
        data-ring={JSON.stringify(drawRing ?? [])}
        data-other-rings={JSON.stringify(otherRings ?? [])}
      />
    )
  },
}))

const TRIANGLE: PolygonRing = [
  [-87.66, 41.92],
  [-87.64, 41.92],
  [-87.65, 41.93],
]

const Harness = ({ initial }: { initial: PolygonRing[] }) => {
  const [rings, setRings] = useState<PolygonRing[]>(initial)
  const [activeIndex, setActiveIndex] = useState(initial.length - 1)
  return (
    <BoundaryDrawPanel
      points={[]}
      truncated={false}
      rings={rings}
      activeIndex={activeIndex}
      onRingsChange={setRings}
      onActiveIndexChange={setActiveIndex}
      pillLabel="3 constituents"
      hint="Tap the map to start"
    />
  )
}

describe('BoundaryDrawPanel', () => {
  it('shows the hint, and no controls, before the first corner', () => {
    render(<Harness initial={[[]]} />)

    expect(screen.getByText('Tap the map to start')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Undo last point' }),
    ).not.toBeInTheDocument()
  })

  it('offers Add another shape only once the active part is a shape', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[TRIANGLE]} />)

    const add = screen.getByRole('button', { name: 'Add another shape' })
    await user.click(add)

    // The new part is active and empty, so there is nothing to add another
    // one beside yet.
    expect(
      screen.queryByRole('button', { name: 'Add another shape' }),
    ).not.toBeInTheDocument()
  })

  // The state right after "+": the bar is still up because the FIRST part
  // has corners, but the active part has none. A live Undo here is a button
  // that looks clickable and does nothing.
  it('disables Undo while the active part has no corners', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[TRIANGLE]} />)

    expect(
      screen.getByRole('button', { name: 'Undo last point' }),
    ).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Add another shape' }))

    expect(
      screen.getByRole('button', { name: 'Undo last point' }),
    ).toBeDisabled()
  })

  // Same dead-control risk reached the other way: switch back to an empty
  // part with the chip row rather than by adding one.
  it('disables Undo after switching to an empty part', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[TRIANGLE, []]} />)

    await user.click(screen.getByRole('button', { name: /Shape 1/ }))
    expect(
      screen.getByRole('button', { name: 'Undo last point' }),
    ).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /Shape 2/ }))
    expect(
      screen.getByRole('button', { name: 'Undo last point' }),
    ).toBeDisabled()
  })

  // `findBy`, not `getBy`: the canvas is a `next/dynamic` import, so it is
  // a loading placeholder on the first render. A synchronous read passed
  // only because the cases above had already resolved the module.
  it('draws the inactive parts read-only and the active one editable', async () => {
    render(<Harness initial={[TRIANGLE, []]} />)

    const map = await screen.findByTestId('contact-map-stub')
    expect(map).toHaveAttribute('data-ring', '[]')
    expect(map).toHaveAttribute('data-other-rings', JSON.stringify([TRIANGLE]))
  })

  // The question a holder reopening a saved list asks: are these shapes
  // fixed now? They are not — selecting one hands it to the map as the
  // editable ring, corners and all, and the others drop back to read-only.
  it('hands a previously drawn part back for editing when its chip is picked', async () => {
    const user = userEvent.setup()
    const second: PolygonRing = [
      [-87.6, 41.8],
      [-87.58, 41.8],
      [-87.59, 41.81],
    ]
    render(<Harness initial={[TRIANGLE, second]} />)

    expect(await screen.findByTestId('contact-map-stub')).toHaveAttribute(
      'data-ring',
      JSON.stringify(second),
    )

    await user.click(screen.getByRole('button', { name: /Shape 1/ }))

    const map = screen.getByTestId('contact-map-stub')
    expect(map).toHaveAttribute('data-ring', JSON.stringify(TRIANGLE))
    expect(map).toHaveAttribute('data-other-rings', JSON.stringify([second]))
  })
})

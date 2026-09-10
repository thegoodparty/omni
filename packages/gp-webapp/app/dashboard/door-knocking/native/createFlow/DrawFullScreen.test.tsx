import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DrawFullScreen } from './DrawFullScreen'

// The drawing surface owns two mutually exclusive states in one slot above the
// footer: the pre-first-point hint before any vertex, and the Undo + count
// pill row from the first vertex onward. Undoing back to zero swaps back to
// the hint — that symmetry is what lets us drop the zero-point Undo feedback
// path (toast + shake on the button) that used to guard it.
const baseProps = {
  pointCount: 0,
  continueDisabled: true,
  onContinue: vi.fn(),
  onClose: vi.fn(),
  onUndoPoint: vi.fn(),
  drawStopCount: 0,
  drawStopsOverCap: false,
}

// Dismiss the instructions AlertDialog seeded open on every mount. It inerts
// the surface behind it, so any query for hint / Undo / pill has to come
// after this — a fact several regressions have already spent time on.
const dismissInstructions = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Got it' }))
}

describe('DrawFullScreen hint / Undo swap', () => {
  it('renders the hint and no Undo/pill before the first point', async () => {
    render(<DrawFullScreen {...baseProps} />)
    await dismissInstructions()

    expect(
      screen.getByText('Tap or click the map to add your first point'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(screen.queryByText(/selected/)).toBeNull()
  })

  it('renders Undo + the count pill and hides the hint once a point lands', async () => {
    render(<DrawFullScreen {...baseProps} pointCount={1} drawStopCount={0} />)
    await dismissInstructions()

    expect(
      screen.queryByText('Tap or click the map to add your first point'),
    ).toBeNull()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    // A ring only exists from three points, so a one-point shape is real but
    // its stop count is still 0. The pill reads what it is handed.
    expect(screen.getByText('0 selected')).toBeInTheDocument()
  })

  // Undoing back to zero has to bring the hint back — otherwise a canvasser
  // who cleared their taps is looking at a bare footer with no gesture named,
  // which is the same state a fresh mount is in and should read the same.
  it('restores the hint when the shape is undone back to zero points', async () => {
    const { rerender } = render(
      <DrawFullScreen {...baseProps} pointCount={2} drawStopCount={0} />,
    )
    await dismissInstructions()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()

    rerender(<DrawFullScreen {...baseProps} pointCount={0} drawStopCount={0} />)

    expect(
      screen.getByText('Tap or click the map to add your first point'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('fires onUndoPoint on click', async () => {
    const onUndoPoint = vi.fn()
    render(
      <DrawFullScreen
        {...baseProps}
        pointCount={3}
        drawStopCount={5}
        onUndoPoint={onUndoPoint}
      />,
    )
    await dismissInstructions()

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))

    expect(onUndoPoint).toHaveBeenCalledTimes(1)
  })

  it('shows the count in the pill', async () => {
    render(<DrawFullScreen {...baseProps} pointCount={4} drawStopCount={42} />)
    await dismissInstructions()

    expect(screen.getByText('42 selected')).toBeInTheDocument()
  })

  // Over-cap is the state that gates the whole route (Continue is disabled
  // upstream). On the map the pill's colour is the whole explanation; the
  // tooltip beside it names the 150-stop limit.
  it('marks the pill destructive when over cap', async () => {
    render(
      <DrawFullScreen
        {...baseProps}
        pointCount={5}
        drawStopCount={151}
        drawStopsOverCap
      />,
    )
    await dismissInstructions()

    const pill = screen.getByText('151 selected')
    // text-destructive-dark (not the base) + border-destructive, matching the
    // styleguide's Alert `destructive` variant so the pair reads legibly.
    expect(pill.className).toMatch(/border-destructive\b/)
    expect(pill.className).toMatch(/text-destructive-dark/)
    // Faintest brand red so the pill reads as an error state without
    // fighting the dark red text on top of it — Alert itself keeps a white
    // bg, but the pill lives over a map, so a subtle tint here is what
    // distinguishes it from the neutral pill next to it.
    expect(pill.className).toMatch(/bg-brand-red-100/)
  })
})

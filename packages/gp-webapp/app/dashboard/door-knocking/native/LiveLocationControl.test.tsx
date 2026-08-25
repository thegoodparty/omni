import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import LiveLocationControl from './LiveLocationControl'
import type { LiveLocation } from './useLiveLocation'

const location = (overrides: Partial<LiveLocation> = {}): LiveLocation => ({
  status: 'off',
  fix: null,
  approximate: false,
  ...overrides,
})

const renderControl = (
  value: LiveLocation,
  enabled = false,
  onToggle = vi.fn(),
) => {
  render(
    <LiveLocationControl
      location={value}
      enabled={enabled}
      onToggle={onToggle}
    />,
  )
  return onToggle
}

describe('LiveLocationControl', () => {
  // The canvas's own label, on the control itself. It used to be an unlabelled
  // icon square with the words only in an aria-label, which is a control a
  // sighted canvasser had to press to find out about.
  it('offers to show the canvasser where they are, in words', () => {
    const onToggle = renderControl(location())

    const pill = screen.getByRole('button', { name: 'My live location' })
    expect(pill).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(pill)

    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('turns tracking back off', () => {
    const onToggle = renderControl(
      location({
        status: 'tracking',
        fix: { lng: 1, lat: 2, accuracyMeters: 8 },
      }),
      true,
    )

    const pill = screen.getByRole('button', { name: 'My live location' })
    // One control with a state, not two controls: the name never changes, so
    // the pressed state is the only thing that has to be read.
    expect(pill).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(pill)

    expect(onToggle).toHaveBeenCalledWith(false)
  })

  // Nothing to offer on an insecure origin, so the map just carries on
  // without a button that could only ever fail.
  it('renders nothing when geolocation is unavailable', () => {
    renderControl(location({ status: 'unavailable' }))

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('explains an unanswered permission prompt', () => {
    renderControl(location({ status: 'locating' }), true)

    expect(screen.getByText('Finding your location…')).toBeInTheDocument()
  })

  // A denial is silent in the browser — without this the button just looks
  // broken.
  it('tells the canvasser how to undo a denial', () => {
    renderControl(location({ status: 'denied' }), true)

    expect(screen.getByRole('status')).toHaveTextContent(
      /Allow it in your browser settings/,
    )
  })

  it('says how far off a coarse fix could be', () => {
    renderControl(
      location({
        status: 'tracking',
        fix: { lng: 1, lat: 2, accuracyMeters: 180 },
        approximate: true,
      }),
      true,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      'Approximate location — accurate to about 180 m.',
    )
  })

  it('stays quiet once the fix is good', () => {
    renderControl(
      location({
        status: 'tracking',
        fix: { lng: 1, lat: 2, accuracyMeters: 6 },
      }),
      true,
    )

    expect(screen.queryByRole('status')).toBeNull()
  })
})

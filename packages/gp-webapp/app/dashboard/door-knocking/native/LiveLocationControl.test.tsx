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
  it('offers to show the canvasser where they are', () => {
    const onToggle = renderControl(location())

    fireEvent.click(screen.getByRole('button', { name: 'Show my location' }))

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

    fireEvent.click(screen.getByRole('button', { name: 'Hide my location' }))

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

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { ManagedPanelSeats, SEAT_FILL_MS } from './ManagedPanelSeats'

const seats = () =>
  screen.getByTestId('managed-panel-seats').querySelectorAll('circle')
const filledSeats = () =>
  [...seats()].filter((seat) => !seat.classList.contains('fill-background'))

const reducedMotion = (reduce: boolean) =>
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes('reduce'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  )

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('<ManagedPanelSeats>', () => {
  it('fills 100 empty seats once, in about 5 seconds', () => {
    vi.useFakeTimers()
    reducedMotion(false)
    render(<ManagedPanelSeats />)

    expect(seats()).toHaveLength(100)
    expect(filledSeats()).toHaveLength(0)
    expect(screen.getByRole('img')).toHaveAccessibleName(
      '0 of 100 seats filled, one for every group in your district',
    )

    act(() => vi.advanceTimersByTime(SEAT_FILL_MS * 50))
    expect(filledSeats()).toHaveLength(50)

    act(() => vi.advanceTimersByTime(SEAT_FILL_MS * 60))
    expect(filledSeats()).toHaveLength(100)
    expect(SEAT_FILL_MS * 100).toBeLessThanOrEqual(5000)
    expect(screen.getByRole('img')).toHaveAccessibleName(
      '100 of 100 seats filled, one for every group in your district',
    )
  })

  it('mixes the brand tints so neighboring seats differ', () => {
    reducedMotion(true)
    render(<ManagedPanelSeats />)
    const colors = [...seats()].map((seat) => seat.getAttribute('class'))
    for (let i = 1; i < colors.length; i++) {
      expect(colors[i]).not.toBe(colors[i - 1])
    }
    expect(colors.join(' ')).toMatch(/fill-brand-red-/)
    expect(colors.join(' ')).toMatch(/fill-brand-blue-/)
    expect(colors.join(' ')).toMatch(/fill-brand-lavender-/)
  })

  it('shows the full arc with no animation under reduced motion', () => {
    vi.useFakeTimers()
    reducedMotion(true)
    render(<ManagedPanelSeats />)
    expect(filledSeats()).toHaveLength(100)
    expect(vi.getTimerCount()).toBe(0)
  })
})

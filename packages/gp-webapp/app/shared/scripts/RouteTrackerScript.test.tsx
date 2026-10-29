import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { usePathname } from 'next/navigation'
import { trackPage } from '@shared/utils/analytics'
import RouteTracker from './RouteTrackerScript'

vi.mock('@shared/utils/analytics', () => ({
  trackPage: vi.fn(() => Promise.resolve(true)),
}))

describe('RouteTracker', () => {
  beforeEach(() => {
    vi.mocked(trackPage).mockClear()
  })

  it('tracks a page view', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard')
    render(<RouteTracker />)
    expect(trackPage).toHaveBeenCalledTimes(1)
  })

  it('never tracks the token-bearing public email pages', () => {
    vi.mocked(usePathname).mockReturnValue('/email/unsubscribe/abc.def')
    render(<RouteTracker />)
    vi.mocked(usePathname).mockReturnValue('/email/forward-confirm/abc')
    render(<RouteTracker />)
    expect(trackPage).not.toHaveBeenCalled()
  })
})

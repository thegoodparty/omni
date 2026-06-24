import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

let mockPathname: string | null = '/'

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

// Isolate Nav's route-based visibility logic from its (provider-heavy)
// children — we only care about whether the global nav chrome is shown.
vi.mock('./LeftSide', () => ({
  default: () => <div data-testid="left-side" />,
}))
vi.mock('./RightSide', () => ({
  default: () => <div data-testid="right-side" />,
}))
vi.mock('./RightSideMobile', () => ({
  default: () => <div data-testid="right-side-mobile" />,
}))
vi.mock('@shared/layouts/navigation/HeaderLogo', () => ({
  HeaderLogo: () => <div data-testid="header-logo" />,
}))

import Nav from './Nav'

const isNavHidden = (container: HTMLElement): boolean =>
  container.querySelector('#top-nav')?.classList.contains('hidden') ?? false

beforeEach(() => {
  mockPathname = '/'
})

describe('Nav global-nav visibility', () => {
  it('shows the global nav on the marketing home route', () => {
    mockPathname = '/'
    const { container, getByTestId } = render(<Nav />)

    expect(isNavHidden(container)).toBe(false)
    expect(getByTestId('left-side')).toBeInTheDocument()
    expect(getByTestId('right-side')).toBeInTheDocument()
  })

  it('hides the global nav inside the serve (elected-official) flow', () => {
    mockPathname = '/serve/onboarding'
    const { container, queryByTestId } = render(<Nav />)

    expect(isNavHidden(container)).toBe(true)
    expect(queryByTestId('left-side')).not.toBeInTheDocument()
    expect(queryByTestId('right-side')).not.toBeInTheDocument()
    expect(queryByTestId('right-side-mobile')).not.toBeInTheDocument()
  })

  it('hides the global nav inside the candidate onboarding flow', () => {
    mockPathname = '/onboarding'
    const { container } = render(<Nav />)

    expect(isNavHidden(container)).toBe(true)
  })

  it('keeps the global nav on routes that merely contain "serve"', () => {
    // Guards against narrowing the prefix check in a way that would catch
    // unrelated marketing routes like /preserve.
    mockPathname = '/preserve'
    const { container, getByTestId } = render(<Nav />)

    expect(isNavHidden(container)).toBe(false)
    expect(getByTestId('left-side')).toBeInTheDocument()
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { getMarketingUrl } from 'helpers/linkhelper'
import LeftSide from './LeftSide'

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}))
vi.mock('@shared/layouts/navigation/NavDropdowns', () => ({
  NavDropdowns: () => null,
}))

describe('LeftSide', () => {
  // gp-webapp has no /pricing route; a relative href 404s on prefetch
  // (ENG-11308).
  it('opens Pricing on the marketing site in a new tab', () => {
    render(<LeftSide />)
    const link = screen.getByTestId('nav-pricing').closest('a')
    expect(link).toHaveAttribute('href', getMarketingUrl('/pricing'))
    expect(link).toHaveAttribute('target', '_blank')
  })
})

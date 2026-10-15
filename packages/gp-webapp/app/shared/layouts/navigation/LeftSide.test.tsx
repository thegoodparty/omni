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
  it('points Pricing at the marketing site', () => {
    render(<LeftSide />)
    expect(screen.getByTestId('nav-pricing').closest('a')).toHaveAttribute(
      'href',
      getMarketingUrl('/pricing'),
    )
  })
})

'use client'

import { usePathname } from 'next/navigation'
import { NavDropdowns } from '@shared/layouts/navigation/NavDropdowns'
import { useMemo } from 'react'
import { Button } from '@styleguide'
import { getMarketingUrl } from 'helpers/linkhelper'

const HIDE_NAV_PATHS = [
  '/onboarding',
  '/dashboard',
  '/dashboard/profile',
  '/polls',
]

const LeftSide = (): React.JSX.Element | null => {
  const pathname = usePathname()
  const shouldHideNav = useMemo(
    () => HIDE_NAV_PATHS.some((path) => pathname?.startsWith(path)),
    [pathname],
  )

  if (shouldHideNav) {
    return null
  }

  return (
    <div className="items-center hidden lg:flex">
      <NavDropdowns dropdownIndices={[0, 1]} />

      <Button
        asChild
        variant="ghost"
        id="nav-pricing"
        className="!py-2 !leading-6 hover:!bg-secondary focus-visible:hover:!bg-secondary hover:!text-white focus-visible:!bg-white focus-visible:!outline-secondary/30 lg:ml-3 xl:ml-6 inline-flex items-center justify-center"
      >
        <a
          href={getMarketingUrl('/pricing')}
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          <span
            className="font-medium text-base leading-6!"
            data-testid="nav-pricing"
          >
            Pricing
          </span>
        </a>
      </Button>

      <NavDropdowns dropdownIndices={[2]} />
    </div>
  )
}

export default LeftSide

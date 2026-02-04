'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Flex } from '@radix-ui/themes'
import { USER_ROUTES, TAB_LABELS } from '../constants'

interface TabNavigationProps {
  userId: string
  isEditMode?: boolean
}

const tabs = [
  { key: 'USER', route: USER_ROUTES.USER, label: TAB_LABELS.USER },
  { key: 'CAMPAIGN', route: USER_ROUTES.CAMPAIGN, label: TAB_LABELS.CAMPAIGN },
  { key: 'P2V', route: USER_ROUTES.P2V, label: TAB_LABELS.P2V },
  {
    key: 'ELECTED_OFFICE',
    route: USER_ROUTES.ELECTED_OFFICE,
    label: TAB_LABELS.ELECTED_OFFICE,
  },
] as const

export function TabNavigation({
  userId,
  isEditMode = false,
}: TabNavigationProps) {
  const pathname = usePathname()

  const basePath = isEditMode
    ? `/dashboard/users/${userId}/edit`
    : `/dashboard/users/${userId}`

  function isActive(route: string): boolean {
    const fullPath = `${basePath}${route}`
    if (route === '') {
      // For the base route, check exact match or that we're not on any sub-route
      return pathname === basePath || pathname === `${basePath}/`
    }
    return pathname.startsWith(fullPath)
  }

  return (
    <Flex gap="0" className="border-b border-[var(--gray-5)]">
      {tabs.map(({ key, route, label }) => {
        const active = isActive(route)
        return (
          <Link
            key={key}
            href={`${basePath}${route}`}
            className={`
              px-4 py-3 text-sm font-medium transition-colors
              border-b-2 -mb-[1px]
              ${
                active
                  ? 'border-[var(--accent-9)] text-[var(--accent-11)]'
                  : 'border-transparent text-[var(--gray-11)] hover:text-[var(--gray-12)] hover:border-[var(--gray-6)]'
              }
            `}
          >
            {label}
          </Link>
        )
      })}
    </Flex>
  )
}

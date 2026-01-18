'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useContext, useState, ReactNode } from 'react'
import { HiUsers, HiStar, HiMenu, HiCog, HiUserGroup } from 'react-icons/hi'
import { Box, Flex, IconButton, Text } from '@radix-ui/themes'
import { useAuthorization } from '@/lib/hooks/useAuthorization'
import { PERMISSIONS, Permission } from '@/lib/permissions'
import { IconType } from 'react-icons'

interface NavItem {
  title: string
  href: string
  icon: IconType
  permission: Permission
}

const allNavItems: NavItem[] = [
  {
    title: 'Users',
    href: '/dashboard/users',
    icon: HiUsers,
    permission: PERMISSIONS.READ_USERS,
  },
  {
    title: 'Campaigns',
    href: '/dashboard/campaigns',
    icon: HiStar,
    permission: PERMISSIONS.READ_CAMPAIGNS,
  },
  {
    title: 'Members',
    href: '/dashboard/members',
    icon: HiUserGroup,
    permission: PERMISSIONS.INVITE_MEMBERS,
  },
  {
    title: 'Settings',
    href: '/dashboard/settings',
    icon: HiCog,
    permission: PERMISSIONS.MANAGE_SETTINGS,
  },
]

type SidebarContextType = {
  isOpen: boolean
  toggle: () => void
}

const SidebarContext = createContext<SidebarContextType | null>(null)

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within SidebarProvider')
  }
  return context
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(true)
  const toggle = () => setIsOpen((prev) => !prev)

  return (
    <SidebarContext.Provider value={{ isOpen, toggle }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function SidebarTrigger() {
  const { toggle } = useSidebar()

  return (
    <IconButton
      variant="ghost"
      onClick={toggle}
      aria-label="Toggle Sidebar"
    >
      <HiMenu style={{ width: 20, height: 20 }} />
    </IconButton>
  )
}

export default function Sidebar() {
  const pathname = usePathname()
  const { isOpen } = useSidebar()
  const { hasPermission, hasActiveOrganization } = useAuthorization()

  // Filter nav items based on user permissions
  // Show no items if no organization is selected
  const navItems = hasActiveOrganization
    ? allNavItems.filter((item) => hasPermission(item.permission))
    : []

  return (
    <Box
      asChild
      style={{
        width: isOpen ? '256px' : '64px',
        height: '100vh',
        borderRight: '1px solid var(--gray-5)',
        backgroundColor: 'var(--gray-2)',
        transition: 'all 0.3s ease-in-out',
      }}
    >
      <aside>
        <nav style={{ flex: 1, padding: '8px' }}>
          <Flex direction="column" gap="1">
            {navItems.length === 0 && hasActiveOrganization === false && (
              <Text
                size="2"
                style={{
                  padding: '8px 12px',
                  color: 'var(--gray-9)',
                  display: isOpen ? 'block' : 'none',
                }}
              >
                Select an organization
              </Text>
            )}
            {navItems.map((item) => {
              const isActive = pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-3)',
                    textDecoration: 'none',
                    color: 'inherit',
                    backgroundColor: isActive ? 'var(--accent-3)' : 'transparent',
                    fontWeight: isActive ? 500 : 400,
                    justifyContent: isOpen ? 'flex-start' : 'center',
                  }}
                  title={!isOpen ? item.title : undefined}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'var(--gray-4)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }
                  }}
                >
                  <item.icon style={{ width: 20, height: 20, flexShrink: 0 }} />
                  <Text
                    size="2"
                    style={{
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      opacity: isOpen ? 1 : 0,
                      width: isOpen ? 'auto' : 0,
                      transition: 'all 0.3s',
                    }}
                  >
                    {item.title}
                  </Text>
                </Link>
              )
            })}
          </Flex>
        </nav>
      </aside>
    </Box>
  )
}

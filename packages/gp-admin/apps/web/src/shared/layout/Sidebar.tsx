'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useContext, useState, ReactNode } from 'react'
import { HiUsers, HiStar, HiMenu, HiCog, HiUserGroup } from 'react-icons/hi'
import { Box, Flex, IconButton, Text } from '@radix-ui/themes'
import { useAuth } from '@clerk/nextjs'
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
    <IconButton variant="ghost" onClick={toggle} aria-label="Toggle Sidebar">
      <HiMenu className="w-5 h-5" />
    </IconButton>
  )
}

export default function Sidebar() {
  const pathname = usePathname()
  const { isOpen } = useSidebar()
  const { has, orgId } = useAuth()

  const navItems = orgId
    ? allNavItems.filter((item) => has?.({ permission: item.permission }))
    : []

  return (
    <Box
      asChild
      flexShrink="0"
      position="sticky"
      top="0"
      height="calc(100vh - 64px)"
      overflowY="auto"
      className={`
        ${isOpen ? 'w-64' : 'w-16'}
        border-r border-[var(--gray-5)] bg-[var(--gray-2)]
        transition-[width] duration-300 ease-in-out
      `}
    >
      <aside>
        <Box asChild p="2">
          <nav aria-label="Main navigation">
            <Flex direction="column" gap="1">
              {navItems.length === 0 && !orgId && (
                <Text
                  size="2"
                  color="gray"
                  className={`px-3 py-2 ${isOpen ? 'block' : 'hidden'}`}
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
                    aria-current={isActive ? 'page' : undefined}
                    className={`
                      flex items-center gap-3 px-3 py-2 rounded-[var(--radius-3)] no-underline
                      ${isActive ? 'bg-[var(--accent-3)] font-medium' : 'hover:bg-[var(--gray-4)]'}
                      ${isOpen ? 'justify-start' : 'justify-center'}
                    `}
                    title={!isOpen ? item.title : undefined}
                  >
                    <item.icon className="w-5 h-5 flex-shrink-0" />
                    <Text
                      size="2"
                      className={`
                        overflow-hidden whitespace-nowrap transition-all duration-300
                        ${isOpen ? 'opacity-100 w-auto' : 'opacity-0 w-0'}
                      `}
                    >
                      {item.title}
                    </Text>
                  </Link>
                )
              })}
            </Flex>
          </nav>
        </Box>
      </aside>
    </Box>
  )
}

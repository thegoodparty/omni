'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Box, Flex, Text } from '@radix-ui/themes'
import { NavigationMenu } from 'radix-ui'
import { useAuth } from '@clerk/nextjs'
import { useSidebar } from './SidebarContext'
import { navItems } from './navItems'

export default function Sidebar() {
  const pathname = usePathname()
  const { isOpen } = useSidebar()
  const { has, orgId } = useAuth()

  const filteredNavItems = orgId
    ? navItems.filter((item) => has?.({ permission: item.permission }))
    : []

  return (
    <Box
      asChild
      flexShrink="0"
      p="2"
      className={`border-r border-[var(--gray-5)] transition-[width] duration-300 ${isOpen ? 'w-[200px]' : 'w-14'}`}
    >
      <aside>
        <NavigationMenu.Root orientation="vertical">
          <NavigationMenu.List>
            {filteredNavItems.length === 0 && !orgId && (
              <Text size="2" color="gray">
                {isOpen ? 'Select an organization' : ''}
              </Text>
            )}
            {filteredNavItems.map((item) => {
              const isActive = pathname.startsWith(item.href)
              return (
                <NavigationMenu.Item key={item.href}>
                  <NavigationMenu.Link asChild active={isActive}>
                    <Link href={item.href}>
                      <Flex align="center" gap="2" py="1">
                        <item.icon className="w-5 h-5" />
                        {isOpen && <Text size="2">{item.title}</Text>}
                      </Flex>
                    </Link>
                  </NavigationMenu.Link>
                </NavigationMenu.Item>
              )
            })}
          </NavigationMenu.List>
        </NavigationMenu.Root>
      </aside>
    </Box>
  )
}

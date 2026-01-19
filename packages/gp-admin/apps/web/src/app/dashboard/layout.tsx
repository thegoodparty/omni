'use client'

import { ReactNode } from 'react'
import Sidebar from '@/shared/layout/Sidebar'
import { OrganizationRequired } from '@/components/OrganizationRequired'
import { Box, Flex } from '@radix-ui/themes'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Flex minHeight="calc(100vh - 64px)">
      <Sidebar />
      <Flex
        direction="column"
        flexGrow="1"
        className="transition-all duration-300"
      >
        <Box asChild p="4" flexGrow="1">
          <main>
            <OrganizationRequired>{children}</OrganizationRequired>
          </main>
        </Box>
      </Flex>
    </Flex>
  )
}

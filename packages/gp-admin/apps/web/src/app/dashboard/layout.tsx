'use client'

import { ReactNode } from 'react'
import Sidebar from '@/shared/layout/Sidebar'
import { Flex, Box } from '@radix-ui/themes'
import { OrganizationRequired } from '@/components/OrganizationRequired'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Flex style={{ minHeight: '100vh' }}>
      <Sidebar />
      <Flex
        direction="column"
        style={{
          flex: 1,
          transition: 'all 0.3s',
        }}
      >
        <Box asChild p="4" style={{ flex: 1 }}>
          <main>
            <OrganizationRequired>{children}</OrganizationRequired>
          </main>
        </Box>
      </Flex>
    </Flex>
  )
}

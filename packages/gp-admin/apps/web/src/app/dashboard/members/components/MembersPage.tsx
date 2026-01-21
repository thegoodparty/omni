'use client'

import { OrganizationProfile } from '@clerk/nextjs'
import { useTheme } from '@/lib/hooks/useTheme'
import { Box, Flex } from '@radix-ui/themes'

export function MembersPage() {
  const { clerkTheme } = useTheme()

  return (
    <Flex align="center" justify="center" flexGrow="1">
      <Box>
        <OrganizationProfile
          appearance={{
            baseTheme: clerkTheme,
            elements: {
              // Hide tabs we don't need for member management
              navbarButton__general: { display: 'none' },
              navbarButton__settings: { display: 'none' },
              profileSection__organizationDanger: { display: 'none' },
            },
          }}
        />
      </Box>
    </Flex>
  )
}

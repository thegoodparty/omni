'use client'

import { OrganizationProfile } from '@clerk/nextjs'
import { Box } from '@radix-ui/themes'

export function MembersPage() {
  return (
    <Box className="-m-4 w-full h-full">
      <OrganizationProfile
        {...{
          appearance: {
            variables: {
              borderRadius: 'none',
              colorBackground: '#f5f5f5',
            },
            elements: {
              rootBox: 'w-full! h-full! border-none! max-w-full!',
              cardBox: 'w-full! h-full! border-none! shadow-none! max-w-full!',
            },
          },
        }}
      />
    </Box>
  )
}

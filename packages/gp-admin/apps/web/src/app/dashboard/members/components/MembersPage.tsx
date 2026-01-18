'use client'

import { OrganizationProfile } from '@clerk/nextjs'

export function MembersPage() {
  return (
    <div className="flex items-center justify-center flex-1">
      <div>
        <OrganizationProfile
          appearance={{
            elements: {
              rootBox: {
                width: '100%',
                maxWidth: '900px',
              },
              card: {
                boxShadow: 'none',
                border: '1px solid var(--gray-5)',
                backgroundColor: 'var(--gray-1)',
              },
              navbar: {
                backgroundColor: 'var(--gray-2)',
                borderRight: '1px solid var(--gray-5)',
              },
              navbarButton: {
                color: 'var(--gray-12)',
                '&:hover': {
                  backgroundColor: 'var(--gray-3)',
                },
              },
              navbarButtonActive: {
                backgroundColor: 'var(--accent-3)',
              },
              pageScrollBox: {
                backgroundColor: 'var(--gray-1)',
              },
              // Hide organization profile/settings options - only show members
              navbarButton__settings: {
                display: 'none',
              },
            },
          }}
        />
      </div>
    </div>
  )
}

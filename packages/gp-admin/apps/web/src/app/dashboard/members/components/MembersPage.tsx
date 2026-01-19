'use client'

import { OrganizationProfile } from '@clerk/nextjs'
import { dark } from '@clerk/themes'
import { useThemeContext } from '@radix-ui/themes'

export function MembersPage() {
  const { appearance } = useThemeContext()
  const isDarkMode = appearance === 'dark'

  return (
    <div className="flex items-center justify-center flex-1">
      <div>
        <OrganizationProfile
          appearance={{
            baseTheme: isDarkMode ? dark : undefined,
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
              navbarButton__general: {
                display: 'none',
              },
              navbarButton__settings: {
                display: 'none',
              },
              'cl-profileSection__organizationDanger': {
                display: 'none',
              },
              profileSection__organizationDanger: {
                display: 'none',
              },
            },
          }}
        />
      </div>
    </div>
  )
}

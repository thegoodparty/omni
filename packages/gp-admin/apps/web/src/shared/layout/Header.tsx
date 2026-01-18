'use client'

import {
  SignInButton,
  SignedIn,
  SignedOut,
  UserButton,
  OrganizationSwitcher,
  useUser,
} from '@clerk/nextjs'
import { DarkLightToggle } from './DarkLightToggle'
import Image from 'next/image'
import { SidebarTrigger } from './Sidebar'
import Link from 'next/link'

export function Header() {
  const { isSignedIn } = useUser()

  return (
    <header className="flex justify-between items-center px-4 py-4 gap-4 h-16 border-b border-[var(--gray-5)]">
      <div className="flex items-center gap-4">
        <Link href="/">
          <Image
            src="https://s3.us-west-2.amazonaws.com/admin-assets.goodparty.org/logo.svg"
            alt="logo"
            width={40}
            height={40}
          />
        </Link>
        {isSignedIn && <SidebarTrigger />}
      </div>
      <div className="flex items-center gap-4">
        <SignedIn>
          <OrganizationSwitcher
            hidePersonal={true}
            afterSelectOrganizationUrl="/dashboard"
            appearance={{
              elements: {
                // Hide the "Create Organization" button
                organizationSwitcherPopoverActionButton__createOrganization: {
                  display: 'none',
                },
                // Dark mode compatibility
                rootBox: {
                  display: 'flex',
                  alignItems: 'center',
                },
                organizationSwitcherTrigger: {
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-3)',
                  border: '1px solid var(--gray-6)',
                  backgroundColor: 'var(--gray-2)',
                  color: 'var(--gray-12)',
                  '&:hover': {
                    backgroundColor: 'var(--gray-3)',
                  },
                },
                organizationPreviewTextContainer: {
                  color: 'var(--gray-12)',
                },
                organizationSwitcherTriggerIcon: {
                  color: 'var(--gray-11)',
                },
              },
            }}
          />
        </SignedIn>
        <DarkLightToggle />
        <SignedOut>
          <SignInButton />
        </SignedOut>
        <SignedIn>
          <UserButton />
        </SignedIn>
      </div>
    </header>
  )
}

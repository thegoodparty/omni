'use client'

import {
  SignInButton,
  SignedIn,
  SignedOut,
  UserButton,
  OrganizationSwitcher,
  useUser,
} from '@clerk/nextjs'
import { useTheme } from '@/lib/hooks/useTheme'
import { DarkLightToggle } from './DarkLightToggle'
import Image from 'next/image'
import { SidebarTrigger } from './Sidebar'
import Link from 'next/link'

export function Header() {
  const { isSignedIn } = useUser()
  const { clerkTheme } = useTheme()

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
              baseTheme: clerkTheme,
              elements: {
                organizationSwitcherPopoverActionButton__createOrganization: {
                  display: 'none',
                },
                rootBox: {
                  display: 'flex',
                  alignItems: 'center',
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
          <UserButton
            appearance={{
              baseTheme: clerkTheme,
            }}
          />
        </SignedIn>
      </div>
    </header>
  )
}

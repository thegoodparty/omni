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
import { Flex } from '@radix-ui/themes'

export function Header() {
  const { isSignedIn } = useUser()

  return (
    <Flex
      asChild
      justify="between"
      align="center"
      p="4"
      gap="4"
      style={{ height: '64px', borderBottom: '1px solid var(--gray-5)' }}
    >
      <header>
        <Flex align="center" gap="4">
          <Image
            src="https://s3.us-west-2.amazonaws.com/admin-assets.goodparty.org/logo.svg"
            alt="logo"
            width={40}
            height={40}
          />
          {isSignedIn && <SidebarTrigger />}
        </Flex>
        <Flex align="center" gap="4">
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
        </Flex>
      </header>
    </Flex>
  )
}

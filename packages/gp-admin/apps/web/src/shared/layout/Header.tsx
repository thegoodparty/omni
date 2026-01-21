'use client'

import {
  SignInButton,
  SignedIn,
  SignedOut,
  UserButton,
  OrganizationSwitcher,
  useUser,
} from '@clerk/nextjs'
import { useClerkTheme } from '@/lib/hooks/useClerkTheme'
import { DarkLightToggle } from './DarkLightToggle'
import Image from 'next/image'
import { SidebarTrigger } from './Sidebar'
import Link from 'next/link'
import { Box, Flex } from '@radix-ui/themes'

export function Header() {
  const { isSignedIn } = useUser()
  const clerkTheme = useClerkTheme()

  return (
    <Box
      asChild
      px="4"
      py="4"
      height="64px"
      className="border-b border-[var(--gray-5)]"
    >
      <header>
        <Flex justify="between" align="center" gap="4" height="100%">
          <Flex align="center" gap="4">
            <Link href="/">
              <Image
                src="https://s3.us-west-2.amazonaws.com/admin-assets.goodparty.org/logo.svg"
                alt="logo"
                width={40}
                height={40}
              />
            </Link>
            {isSignedIn && <SidebarTrigger />}
          </Flex>
          <Flex align="center" gap="4">
            <SignedIn>
              <OrganizationSwitcher
                hidePersonal={true}
                afterSelectOrganizationUrl="/dashboard"
                appearance={{
                  baseTheme: clerkTheme,
                  elements: {
                    organizationSwitcherPopoverActionButton__createOrganization:
                      {
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
          </Flex>
        </Flex>
      </header>
    </Box>
  )
}

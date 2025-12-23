'use client'

import {
  SignInButton,
  SignedIn,
  SignedOut,
  UserButton,
  useUser,
} from '@clerk/nextjs'
import { DarkLightToggle } from './DarkLightToggle'
import Image from 'next/image'
import { SidebarTrigger } from './Sidebar'
import { isE2ETesting } from '@/shared/hooks/useE2ETesting'

const MockUserButton = () => (
  <div
    className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-medium"
    data-testid="mock-user-button"
    role="button"
    aria-label="Test user avatar"
    tabIndex={0}
  >
    T
  </div>
)

export function Header() {
  const e2eTesting = isE2ETesting()
  const user = useUser()

  return (
    <header className="flex justify-between items-center p-4 gap-4 h-16 border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-center gap-4">
        <Image
          src="https://s3.us-west-2.amazonaws.com/admin-assets.goodparty.org/logo.svg"
          alt="logo"
          width={40}
          height={40}
        />
        {(user?.isSignedIn || e2eTesting) && (
          <div>
            <SidebarTrigger />
          </div>
        )}
      </div>
      <div className="flex items-center gap-4">
        <DarkLightToggle />
        {e2eTesting ? (
          <MockUserButton />
        ) : (
          <>
            <SignedOut>
              <SignInButton />
            </SignedOut>
            <SignedIn>
              <UserButton />
            </SignedIn>
          </>
        )}
      </div>
    </header>
  )
}

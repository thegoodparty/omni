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

export function Header() {
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
        {user?.isSignedIn && (
          <div>
            <SidebarTrigger />
          </div>
        )}
      </div>
      <div className="flex items-center gap-4">
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

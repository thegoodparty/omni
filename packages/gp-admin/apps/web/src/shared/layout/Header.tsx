'use client'

import { SignInButton, SignedIn, SignedOut, UserButton } from '@clerk/nextjs'
import { DarkLightToggle } from './DarkLightToggle'
import Image from 'next/image'
import { SidebarTrigger } from './Sidebar'
import { useEffect, useState } from 'react'

const MockUserButton = () => (
  <div
    className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-medium"
    data-testid="mock-user-button"
  >
    T
  </div>
)

export function Header() {
  const [isE2ETesting, setIsE2ETesting] = useState(false)

  useEffect(() => {
    const hasEnvFlag = process.env.NEXT_PUBLIC_E2E_TESTING === 'true'
    const hasCookie = document.cookie.includes('__e2e_bypass=true')
    setIsE2ETesting(hasEnvFlag || hasCookie)
  }, [])


export async function Header() {

  return (
    <header className="flex justify-between items-center p-4 gap-4 h-16 border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-center gap-4">
        <Image
          src="https://s3.us-west-2.amazonaws.com/admin-assets.goodparty.org/logo.svg"
          alt="logo"
          width={40}
          height={40}
        />
      
          <div>
            <SidebarTrigger />
          </div>
     
      </div>
      <div className="flex items-center gap-4">
        <DarkLightToggle />
        {isE2ETesting ? (
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

import { SignInButton, SignedIn, SignedOut, UserButton } from '@clerk/nextjs'
import { DarkLightToggle } from './DarkLightToggle'
import Image from 'next/image'
import { SidebarTrigger } from './Sidebar'

export function Header() {
  return (
    <header className="flex justify-between items-center p-4 gap-4 h-16 border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-center gap-4">
        <Image
          src="https://assets.goodparty.org/logo.svg"
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

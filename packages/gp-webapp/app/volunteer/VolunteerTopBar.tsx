'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { SidebarProvider } from '@styleguide'
import { useUser } from '@shared/hooks/useUser'
import { OrganizationPicker } from '@shared/organization-picker'
import ProfileDropdown from '@shared/layouts/navigation/ProfileDropdown'
import type { User } from 'helpers/types'

// The volunteer shell's entire top bar: logo, org picker, profile dropdown.
// No left rail and no dashboard nav — a volunteer's surface is a distinct
// route group, not a gated dashboard (Team accounts TDD, Phase 1.5).
//
// `OrganizationPicker` is a `SidebarMenuButton` under the hood, which throws
// outside a `SidebarProvider` — wrapped here for that context only; no
// `<Sidebar>` rail is rendered.
const VolunteerTopBar = (): React.JSX.Element => {
  const [user] = useUser()
  const [profileOpen, setProfileOpen] = useState(false)

  return (
    <SidebarProvider className="min-h-0 w-full shrink-0">
      <header className="flex h-14 w-full items-center justify-between gap-3 border-b border-base-border bg-background px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/volunteer" className="flex shrink-0 items-center">
            <Image
              src="/images/logo/heart.svg"
              width={30}
              height={24}
              alt="GoodParty.org"
              priority
            />
          </Link>
          <div className="w-56 max-w-full">
            <OrganizationPicker />
          </div>
        </div>
        {user && (
          <ProfileDropdown
            open={profileOpen}
            toggleCallback={() => setProfileOpen((open) => !open)}
            user={user as User}
          />
        )}
      </header>
    </SidebarProvider>
  )
}

export default VolunteerTopBar

'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Badge, SidebarProvider } from '@styleguide'
import { useUser } from '@shared/hooks/useUser'
import {
  OrganizationPicker,
  useOrganization,
} from '@shared/organization-picker'
import ProfileDropdown from '@shared/layouts/navigation/ProfileDropdown'
import type { User } from 'helpers/types'

// The volunteer shell's top bar (logo, "Volunteer" badge, org picker, profile
// dropdown) plus the campaign banner rendered just below it. No left rail and
// no dashboard nav — a volunteer's surface is a distinct route group, not a
// gated dashboard (Team accounts TDD, Phase 1.5). HYBRID decision
// (ENG-11065): the Lovable design's sidebar isn't rebuilt here — the top bar
// and OrganizationPicker stay, since a multi-campaign volunteer still needs
// to switch orgs — but the badge and banner are added so a volunteer always
// sees which campaign they're working for.
//
// `OrganizationPicker` is a `SidebarMenuButton` under the hood, which throws
// outside a `SidebarProvider` — wrapped here for that context only; no
// `<Sidebar>` rail is rendered.
const VolunteerTopBar = (): React.JSX.Element => {
  const [user] = useUser()
  const [profileOpen, setProfileOpen] = useState(false)
  const organization = useOrganization()

  return (
    // flex-col: the wrapper div defaults to a flex ROW, which would place the
    // banner beside the header instead of below it.
    <SidebarProvider className="min-h-0 w-full shrink-0 flex-col">
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
          <Badge variant="soft" className="shrink-0">
            Volunteer
          </Badge>
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
      {organization?.name && (
        <div className="w-full truncate border-b border-base-border bg-muted px-4 py-2 text-sm font-medium text-foreground">
          {organization.name}
        </div>
      )}
    </SidebarProvider>
  )
}

export default VolunteerTopBar

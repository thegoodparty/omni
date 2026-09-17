'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  Avatar,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  RadioGroup,
  RadioGroupItem,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@styleguide'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  LogOutIcon,
  UserIcon,
} from '@styleguide/components/ui/icons'
import { useUser } from '@shared/hooks/useUser'
import { useHandleLogOut } from '@shared/user/handleLogOut'
import {
  useOrganization,
  useOrganizations,
  useSetOrganizationSlug,
} from '@shared/organization-picker'
import { useTeamAccountsFlag } from '@shared/experiments/teamAccountsFlag'

// The volunteer shell: a left sidebar (logo/wordmark, a bottom user block that
// expands an in-sidebar "switch campaign" list, and a logout row) plus a slim
// top bar over the content that names the active campaign (Lovable design,
// ENG-11068 — supersedes ENG-11065's hybrid top-bar-plus-banner shell). No
// dashboard nav, no org picker in a header, no avatar dropdown menu, and no
// "run for a new office" affordance — a volunteer only ever has one thing to
// do here (their assignments) and, when they hold more than one campaign, one
// thing to switch.
const VolunteerSidebar = ({
  children,
}: {
  children: ReactNode
}): React.JSX.Element => {
  const [user] = useUser()
  const organization = useOrganization()
  const organizations = useOrganizations()
  const setOrganizationSlug = useSetOrganizationSlug()
  const handleLogOut = useHandleLogOut()
  const router = useRouter()
  // trackExposure=false: a render-decision read for switch routing, same as
  // OrganizationPicker's own read of this flag — not the experiment's own
  // treatment surface.
  const { enabled: teamAccountsEnabled } = useTeamAccountsFlag(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)

  // A single-campaign volunteer has nothing to switch to — the user block
  // stays a plain, non-interactive summary (requirement: still show the
  // campaign name, but no switch affordance or list).
  const canSwitchCampaigns = organizations.length > 1

  // The list isn't filtered to volunteer-role orgs (a volunteer can also own
  // or manage other campaigns), so picking one can leave the shell that fits
  // the DESTINATION org's role, not this one — mirrors
  // OrganizationPicker.handleOrgSwitch's destination rule exactly (this
  // shell has no SHARED_PATHS-style stay-put case: every /volunteer/* route
  // is scoped to one org, so always navigating here also clears a stale
  // deep route like /volunteer/phone-banking/[listId] left over from the
  // org being switched away from).
  const handleOrgSelect = (slug: string) => {
    setOrganizationSlug(slug)
    setSwitcherOpen(false)
    const destination = organizations.find((org) => org.slug === slug)
    router.push(
      teamAccountsEnabled && destination?.role === 'volunteer'
        ? '/volunteer'
        : destination?.electedOfficeId
          ? '/dashboard/chief-of-staff'
          : '/dashboard',
    )
  }

  return (
    <SidebarProvider className="min-h-svh">
      {/*
        The Sidebar primitive's visible fill is its inner element's hardcoded
        `bg-sidebar`, which resolves through the CSS variable
        `--sidebar-background` (no Tailwind utility reaches that inner div
        directly) — override the variable here to get the design's
        light-gray fill instead of the primitive's default white.
      */}
      <Sidebar
        style={
          {
            '--sidebar-background': 'var(--color-muted)',
          } as React.CSSProperties
        }
      >
        <SidebarHeader>
          <Link
            href="/volunteer"
            className="flex items-center gap-2 px-2 py-1.5"
          >
            <Image
              src="/images/logo/heart.svg"
              width={24}
              height={18}
              alt="GoodParty.org"
              priority
            />
            <span className="text-sm font-semibold text-foreground">
              Volunteer
            </span>
          </Link>
        </SidebarHeader>
        <SidebarContent />
        <SidebarFooter>
          {canSwitchCampaigns ? (
            <Collapsible open={switcherOpen} onOpenChange={setSwitcherOpen}>
              {!switcherOpen && (
                <UserBlock
                  user={user}
                  organizationName={organization?.name}
                  trigger={
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        size="sm"
                        aria-label="Switch campaign"
                        className="size-7 shrink-0 p-0"
                      >
                        <ChevronDownIcon className="size-4" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                  }
                />
              )}
              <CollapsibleContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        size="sm"
                        className="justify-between text-xs font-medium tracking-wide text-muted-foreground uppercase"
                      >
                        <span>Switch campaign</span>
                        <ChevronUpIcon className="size-3" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                  </SidebarMenuItem>
                </SidebarMenu>
                <RadioGroup
                  value={organization?.slug ?? ''}
                  onValueChange={handleOrgSelect}
                  className="gap-1 px-2 pb-2"
                >
                  {organizations.map((org) => (
                    <label
                      key={org.slug}
                      htmlFor={`switch-campaign-${org.slug}`}
                      className="flex cursor-pointer items-center gap-2 rounded-md py-1.5"
                    >
                      <Avatar className="size-8 shrink-0">
                        <Avatar.Fallback className="bg-background">
                          <UserIcon className="size-4 text-muted-foreground" />
                        </Avatar.Fallback>
                      </Avatar>
                      <div className="flex min-w-0 flex-1 flex-col leading-none">
                        <span className="truncate text-sm font-medium text-foreground">
                          {org.ownerName ?? org.name}
                        </span>
                        {org.name && (
                          <span className="truncate text-xs text-muted-foreground">
                            {org.name}
                          </span>
                        )}
                      </div>
                      <RadioGroupItem
                        value={org.slug}
                        id={`switch-campaign-${org.slug}`}
                      />
                    </label>
                  ))}
                </RadioGroup>
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <UserBlock user={user} organizationName={organization?.name} />
          )}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={handleLogOut}>
                <LogOutIcon className="size-4" />
                <span>Logout</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header
          data-testid="volunteer-campaign-bar"
          className="flex h-14 w-full shrink-0 items-center gap-2 border-b border-base-border bg-background px-4"
        >
          <SidebarTrigger className="lg:hidden" />
          {organization?.name && (
            <span className="truncate text-sm font-semibold text-foreground">
              {organization.name}
            </span>
          )}
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}

interface VolunteerUser {
  firstName?: string | null
  lastName?: string | null
  avatar?: string | null
}

const UserBlock = ({
  user,
  organizationName,
  trigger,
}: {
  user: VolunteerUser | null
  organizationName: string | null | undefined
  trigger?: ReactNode
}): React.JSX.Element => (
  <SidebarMenu>
    <SidebarMenuItem>
      <div className="flex items-center gap-2 p-2">
        <Avatar className="size-8 shrink-0">
          <Avatar.Image src={user?.avatar || undefined} />
          <Avatar.Fallback className="bg-background">
            <UserIcon className="size-4 text-muted-foreground" />
          </Avatar.Fallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col leading-none">
          <span className="truncate text-sm font-semibold text-foreground">
            {user?.firstName} {user?.lastName}
          </span>
          {organizationName && (
            <span className="truncate text-xs text-muted-foreground">
              {organizationName}
            </span>
          )}
        </div>
        {trigger}
      </div>
    </SidebarMenuItem>
  </SidebarMenu>
)

export default VolunteerSidebar

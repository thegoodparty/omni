'use client'

import { useState, type ReactNode } from 'react'
import { type LucideIcon } from 'lucide-react'
import {
  Avatar,
  AvatarIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  GoodPartyOrgLogo,
  ProBadge,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  useSidebar,
} from '@goodparty_org/styleguide'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CircleUserRoundIcon,
  ExternalLinkIcon,
  LogOutIcon,
  SettingsIcon,
  UserCogIcon,
  UserRoundIcon,
} from '@styleguide/components/ui/icons'

export type PrototypeTab = {
  slug: string
  label: string
  icon: LucideIcon
  component: ReactNode
}

export type ShellOrg = {
  id: string
  name: string
  isPro: boolean
  tabs: PrototypeTab[]
}

type AppShellProps = {
  userName: string
  orgs: ShellOrg[]
}

const ACCOUNT_ITEMS = [
  { label: 'Profile', icon: CircleUserRoundIcon },
  { label: 'Settings', icon: SettingsIcon },
  { label: 'Account', icon: UserCogIcon },
]

// Org switcher: heart + GoodParty.org (+ PRO) + org name + chevron, opening the
// org / run-for-office dropdown. Mirrors the Product Navigation pattern.
const OrgSwitcher = ({
  orgs,
  activeOrgId,
  onSelect,
}: {
  orgs: ShellOrg[]
  activeOrgId: string
  onSelect: (id: string) => void
}) => {
  const org = orgs.find((o) => o.id === activeOrgId) ?? orgs[0]
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="gap-3 data-[state=open]:bg-sidebar-accent"
            >
              <GoodPartyOrgLogo className="!h-[24px] !w-[30px]" />
              <div className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="flex items-center gap-1.5 text-sm">
                  GoodParty.org
                  {org?.isPro && <ProBadge size="small" />}
                </span>
                <span className="truncate text-sm font-semibold">
                  {org?.name}
                </span>
              </div>
              <ChevronDownIcon className="ml-auto size-4 shrink-0" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-72 rounded-lg"
            align="start"
            sideOffset={4}
          >
            <DropdownMenuRadioGroup
              value={activeOrgId}
              onValueChange={onSelect}
            >
              {orgs.map((o) => (
                <DropdownMenuRadioItem key={o.id} value={o.id}>
                  <span className="flex-1">{o.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <span className="flex-1">Run for a new office</span>
              <ChevronRightIcon className="size-4" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

// Nav list. On mobile the drawer also holds the account items (Community Forum,
// profile items, Logout) inline — the footer dropdown is desktop-only.
const NavList = ({
  tabs,
  activeSlug,
  onSelect,
}: {
  tabs: PrototypeTab[]
  activeSlug: string
  onSelect: (slug: string) => void
}) => {
  const { isMobile, setOpenMobile } = useSidebar()
  const handleSelect = (slug: string) => {
    onSelect(slug)
    // Close the offcanvas drawer after picking a tab on mobile.
    if (isMobile) setOpenMobile(false)
  }
  return (
    <SidebarMenu>
      {tabs.map((tab) => {
        const Icon = tab.icon
        return (
          <SidebarMenuItem key={tab.slug}>
            <SidebarMenuButton
              isActive={tab.slug === activeSlug}
              onClick={() => handleSelect(tab.slug)}
              className="h-10 gap-2 rounded-md px-4 py-2.5 text-sm"
            >
              <Icon size={16} />
              <span>{tab.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
      {isMobile && (
        <>
          <SidebarSeparator />
          <SidebarMenuItem>
            <SidebarMenuButton className="h-10 gap-2 rounded-md px-4 py-2.5 text-sm">
              <ExternalLinkIcon size={16} />
              <span>Community Forum</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarSeparator />
          {ACCOUNT_ITEMS.map((item) => (
            <SidebarMenuItem key={item.label}>
              <SidebarMenuButton className="h-10 gap-2 rounded-md px-4 py-2.5 text-sm">
                <item.icon size={16} />
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          <SidebarSeparator />
          <SidebarMenuItem>
            <SidebarMenuButton className="h-10 gap-2 rounded-md px-4 py-2.5 text-sm">
              <LogOutIcon size={16} />
              <span>Logout</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </>
      )}
    </SidebarMenu>
  )
}

// Account footer with dropdown — desktop only (mobile shows these inline in NavList).
const UserFooter = ({ userName }: { userName: string }) => {
  const { isMobile } = useSidebar()
  if (isMobile) return null
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton className="h-auto gap-2 p-2 data-[state=open]:bg-sidebar-accent">
              <Avatar shape="square" size="small">
                <AvatarIcon>
                  <UserRoundIcon />
                </AvatarIcon>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-left leading-none">
                <span className="truncate text-sm font-semibold">
                  {userName}
                </span>
                <span className="truncate text-xs">Manage account</span>
              </div>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side="right"
            align="end"
            sideOffset={4}
          >
            {ACCOUNT_ITEMS.map((item) => (
              <DropdownMenuItem key={item.label}>
                <item.icon size={16} className="text-foreground" />
                <span>{item.label}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <ExternalLinkIcon size={16} className="text-foreground" />
              <span>Community Forum</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <LogOutIcon size={16} className="text-foreground" />
              <span>Logout</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export const AppShell = ({ userName, orgs }: AppShellProps) => {
  const [activeOrgId, setActiveOrgId] = useState(orgs[0]?.id ?? '')
  const org = orgs.find((o) => o.id === activeOrgId) ?? orgs[0]
  const [activeSlug, setActiveSlug] = useState(org?.tabs[0]?.slug ?? '')

  const selectOrg = (id: string) => {
    const next = orgs.find((o) => o.id === id)
    if (!next) return
    setActiveOrgId(id)
    setActiveSlug(next.tabs[0]?.slug ?? '')
  }

  const activeTab = org?.tabs.find((t) => t.slug === activeSlug) ?? org?.tabs[0]

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <OrgSwitcher
            orgs={orgs}
            activeOrgId={activeOrgId}
            onSelect={selectOrg}
          />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <NavList
                tabs={org?.tabs ?? []}
                activeSlug={activeSlug}
                onSelect={setActiveSlug}
              />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <UserFooter userName={userName} />
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="bg-muted">
        <div className="flex min-h-0 flex-1 flex-col">
          {activeTab?.component}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

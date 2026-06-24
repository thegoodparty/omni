'use client'

import { useState } from 'react'
import { type LucideIcon } from 'lucide-react'
import { type ReactNode } from 'react'
import {
  ChevronDown,
  CircleUserRound,
  ExternalLink,
  LogOut,
  Settings,
  UserCog,
  UserRound,
} from 'lucide-react'
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
  ArrowRightIcon,
} from '@goodparty_org/styleguide'

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

// The GoodParty.org heart, copied verbatim from the webapp OrganizationPicker so
// the rail header is pixel-identical.
const Logo = () => (
  <div className="h-[24px] w-[32px]">
    <svg
      width={32}
      height={24}
      viewBox="0 0 32 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M16.0021 21.306C21.2331 18.7631 24.7057 15.9097 26.4789 12.9823C27.9714 10.4985 28.1635 8.08866 27.2178 6.09274C26.3607 4.28903 24.6318 3.00278 22.6222 2.66274C20.4795 2.30791 18.3073 3.06192 16.5932 4.93955L15.9873 5.59006L15.3815 4.93955C13.6526 3.06192 11.4804 2.30791 9.3525 2.66274C7.35762 2.98799 5.61395 4.28903 4.75689 6.09274C3.81117 8.07387 4.00327 10.4985 5.49574 12.9823C7.26896 15.9097 10.7415 18.7631 15.9726 21.306H16.0021Z"
        fill="white"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M16.0022 4.14121C14.0959 2.1453 11.643 1.2878 9.2048 1.70176C6.88482 2.08616 4.87517 3.5794 3.87034 5.6788C2.76207 8.02954 3.02805 10.809 4.66828 13.4998C6.5745 16.6637 10.254 19.6206 15.5736 22.1931L16.0022 22.4001L16.4307 22.1931C21.7504 19.6058 25.415 16.6489 27.336 13.4998C28.9615 10.809 29.2423 8.02954 28.134 5.6788C27.1292 3.56462 25.1195 2.08616 22.7995 1.70176C20.3613 1.30258 17.9084 2.1453 16.0022 4.14121ZM14.6574 5.63445C13.1354 3.97859 11.2883 3.37242 9.5151 3.66811C7.83053 3.94901 6.36762 5.04306 5.65833 6.5363C4.88993 8.1626 4.99337 10.2177 6.35284 12.4797C7.93397 15.0965 11.0815 17.7578 15.9874 20.1972C20.8933 17.7578 24.026 15.0965 25.6219 12.4797C26.9962 10.2177 27.0848 8.1626 26.3164 6.5363C25.6071 5.02828 24.1442 3.94901 22.4597 3.66811C20.6864 3.37242 18.8393 3.97859 17.3173 5.63445L15.9874 7.08333L14.6574 5.63445Z"
        fill="#DC1438"
      />
      <path
        d="M15.4701 14.1653L14.0515 14.9045C13.9037 14.9785 13.7264 14.9193 13.6525 14.7863C13.623 14.7271 13.6082 14.668 13.623 14.5941L13.889 13.0417C13.9481 12.6721 13.8298 12.3025 13.5639 12.0511L12.4113 10.9423C12.293 10.824 12.293 10.6466 12.4113 10.5283C12.4556 10.484 12.5147 10.4544 12.5886 10.4396L14.1845 10.2178C14.5539 10.1587 14.879 9.93693 15.0415 9.59689L15.7508 8.17758C15.8247 8.02973 16.002 7.9706 16.1498 8.04452C16.2089 8.07409 16.2532 8.11844 16.2828 8.17758L16.9921 9.59689C17.1546 9.92215 17.4797 10.1587 17.8491 10.2178L19.4451 10.4396C19.6076 10.4692 19.7258 10.617 19.6963 10.7649C19.6963 10.824 19.6519 10.8831 19.6076 10.9275L18.455 12.0363C18.189 12.2877 18.056 12.6721 18.1299 13.0269L18.3959 14.5793C18.4255 14.7419 18.322 14.8898 18.1595 14.9193C18.1004 14.9193 18.0265 14.9193 17.9674 14.8898L16.5488 14.1505C16.2089 13.9731 15.8099 13.9731 15.4849 14.1505L15.4701 14.1653Z"
        fill="#0048C2"
      />
    </svg>
  </div>
)

const ACCOUNT_ITEMS = [
  { label: 'Profile', icon: CircleUserRound },
  { label: 'Settings', icon: Settings },
  { label: 'Account', icon: UserCog },
]

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
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  >
                    <Logo />
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <div className="flex items-center gap-1">
                        <p className="font-opensans truncate text-sm">
                          GoodParty.org
                        </p>
                        {org?.isPro && <ProBadge size="small" />}
                      </div>
                      <span className="font-opensans truncate text-sm font-semibold">
                        {org?.name}
                      </span>
                    </div>
                    <ChevronDown className="ml-auto self-end" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="min-w-(--radix-dropdown-menu-trigger-width) rounded-lg"
                  align="start"
                  side="right"
                  sideOffset={4}
                >
                  <DropdownMenuGroup>
                    {orgs.map((o) => {
                      const isSelected = o.id === org?.id
                      return (
                        <DropdownMenuItem
                          key={o.id}
                          onClick={() => selectOrg(o.id)}
                          className="gap-2 px-2 py-2.5"
                        >
                          <span
                            className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
                              isSelected
                                ? 'border-primary bg-primary'
                                : 'border-muted-foreground'
                            }`}
                          >
                            {isSelected && (
                              <span className="size-1.5 rounded-full bg-white" />
                            )}
                          </span>
                          <span className="font-opensans text-sm">
                            {o.name}
                          </span>
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem className="gap-2 px-2 py-2.5">
                      <span className="font-opensans text-sm">
                        Run for a new office
                      </span>
                      <ArrowRightIcon className="ml-auto" />
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {org?.tabs.map((tab) => {
                  const Icon = tab.icon
                  return (
                    <SidebarMenuItem key={tab.slug}>
                      <SidebarMenuButton
                        isActive={tab.slug === activeSlug}
                        onClick={() => setActiveSlug(tab.slug)}
                        className="font-opensans h-10 gap-2 rounded-md px-4 py-2.5 text-sm"
                      >
                        <Icon size={16} />
                        <span>{tab.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton className="font-opensans h-auto gap-2 p-2 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                    <Avatar className="border-border size-8 shrink-0 rounded-lg border">
                      <Avatar.Fallback className="rounded-lg bg-white">
                        <UserRound className="text-muted-foreground size-5" />
                      </Avatar.Fallback>
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
                  className="font-opensans min-w-56 rounded-lg"
                  side="right"
                  align="end"
                  sideOffset={4}
                >
                  {ACCOUNT_ITEMS.map((item) => (
                    <DropdownMenuItem key={item.label} className="h-10">
                      <item.icon size={16} className="text-foreground" />
                      <span>{item.label}</span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="h-10">
                    <ExternalLink size={16} className="text-foreground" />
                    <span>Community Forum</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="h-10">
                    <LogOut size={16} className="text-foreground" />
                    <span>Logout</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="bg-[#f5f5f5]">
        <div className="flex-1 p-2 md:p-4">{activeTab?.component}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}

'use client'

import { useState } from 'react'
import { type LucideIcon } from 'lucide-react'
import { type ReactNode } from 'react'
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
  SidebarInset,
  GoodPartyOrgLogo,
  Avatar,
  AvatarIcon,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
} from '@goodparty_org/styleguide'
import {
  ChevronsUpDownIcon,
  ExternalLinkIcon,
  LogOutIcon,
  SettingsIcon,
  UserRoundIcon,
} from '@styleguide/components/ui/icons'

export type PrototypeTab = {
  slug: string
  label: string
  icon: LucideIcon
  component: ReactNode
}

export type ShellMode = {
  id: string
  label: string
  role: string
  tabs: PrototypeTab[]
}

type AppShellProps = {
  userName: string
  modes: ShellMode[]
}

export const AppShell = ({ userName, modes }: AppShellProps) => {
  const [activeModeId, setActiveModeId] = useState(modes[0]?.id ?? '')
  const mode = modes.find((m) => m.id === activeModeId) ?? modes[0]
  const [activeSlug, setActiveSlug] = useState(mode?.tabs[0]?.slug ?? '')

  const selectMode = (id: string) => {
    const next = modes.find((m) => m.id === id)
    if (!next) return
    setActiveModeId(id)
    setActiveSlug(next.tabs[0]?.slug ?? '')
  }

  const activeTab =
    mode?.tabs.find((t) => t.slug === activeSlug) ?? mode?.tabs[0]
  const ActiveIcon = activeTab?.icon

  return (
    <SidebarProvider>
      <Sidebar collapsible="none">
        <SidebarHeader className="h-16 justify-center border-b px-4">
          <div className="flex items-center gap-2">
            <GoodPartyOrgLogo className="!h-[24px] !w-[30px]" />
            <span className="text-lg font-semibold">{mode?.label}</span>
          </div>
        </SidebarHeader>

        <SidebarContent className="px-2 py-3">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {mode?.tabs.map((tab) => {
                  const Icon = tab.icon
                  return (
                    <SidebarMenuItem key={tab.slug}>
                      <SidebarMenuButton
                        isActive={tab.slug === activeSlug}
                        onClick={() => setActiveSlug(tab.slug)}
                        className="h-10 gap-3 rounded-md px-3 text-sm"
                      >
                        <Icon size={18} />
                        <span>{tab.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator className="mx-0" />

          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                <SidebarMenuItem>
                  <SidebarMenuButton className="h-10 gap-3 rounded-md px-3 text-sm">
                    <ExternalLinkIcon size={18} />
                    <span>Community Forum</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="gap-1 border-t p-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton className="h-auto gap-3 p-2 data-[state=open]:bg-sidebar-accent">
                    <Avatar shape="square" size="small">
                      <AvatarIcon>
                        <UserRoundIcon />
                      </AvatarIcon>
                    </Avatar>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-left leading-none">
                      <span className="truncate text-sm font-semibold">
                        {userName}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        {mode?.role}
                      </span>
                    </div>
                    <ChevronsUpDownIcon className="ml-auto size-4 shrink-0" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-64 rounded-lg"
                  side="top"
                  align="start"
                  sideOffset={8}
                >
                  <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={activeModeId}
                    onValueChange={selectMode}
                  >
                    {modes.map((m) => (
                      <DropdownMenuRadioItem key={m.id} value={m.id}>
                        <span className="flex-1">{m.label}</span>
                        <span className="text-muted-foreground text-xs">
                          {m.role}
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton className="h-9 gap-3 rounded-md px-3 text-sm">
                <SettingsIcon size={18} />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton className="h-9 gap-3 rounded-md px-3 text-sm">
                <LogOutIcon size={18} />
                <span>Logout</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-16 items-center gap-2 border-b px-6">
          {ActiveIcon && <ActiveIcon size={18} className="text-foreground" />}
          <h1 className="text-base font-semibold">{activeTab?.label}</h1>
        </header>
        <div className="flex-1 overflow-auto">{activeTab?.component}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}

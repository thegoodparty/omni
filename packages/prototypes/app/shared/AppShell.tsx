'use client'

import { useState } from 'react'
import { type LucideIcon } from 'lucide-react'
import { type ReactNode } from 'react'
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
} from '@goodparty_org/styleguide'

type PrototypeTab = {
  slug: string
  label: string
  icon: LucideIcon
  component: ReactNode
}

type AppShellProps = {
  title: string
  tabs: PrototypeTab[]
}

export const AppShell = ({ title, tabs }: AppShellProps) => {
  const [activeSlug, setActiveSlug] = useState(tabs[0]?.slug ?? '')

  const activeTab = tabs.find((t) => t.slug === activeSlug)

  return (
    <SidebarProvider>
      <Sidebar collapsible="none">
        <SidebarHeader>
          <span>{title}</span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <SidebarMenuItem key={tab.slug}>
                  <SidebarMenuButton
                    isActive={tab.slug === activeSlug}
                    onClick={() => setActiveSlug(tab.slug)}
                  >
                    <Icon />
                    <span>{tab.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>{activeTab?.component}</SidebarInset>
    </SidebarProvider>
  )
}

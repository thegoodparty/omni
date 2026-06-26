import * as React from 'react'
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  BotIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleUserRoundIcon,
  ClipboardListIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GlobeIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  SendIcon,
  SettingsIcon,
  SparklesIcon,
  UserCogIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from '../components/ui/icons'
import { ProBadge } from '../components/ui/pro-badge'
import { GoodPartyOrgLogo } from '../components/ui/good-party-org-logo'
import { Avatar, AvatarIcon } from '../components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from '../components/ui/sidebar'

// A presentational mirror of the product navigation
// (`app/dashboard/shared/DashboardMenu.tsx`). It composes the real `Sidebar`
// primitive with mock data so the nav can be reviewed visually in Storybook,
// without routing/auth/feature-flag wiring — like every other story here, the
// links and dropdowns are visual, not functional. `mode` switches between the
// campaign and elected-office configurations; `device` switches between the
// desktop rail and the mobile bar + drawer.

type Mode = 'campaign' | 'electedOffice'
type Device = 'desktop' | 'mobile'

type NavItem = {
  id: string
  label: string
  icon: React.ComponentType<{ size?: number }>
}

const CAMPAIGN_ITEMS: NavItem[] = [
  {
    id: 'campaign-manager',
    label: 'Campaign Manager',
    icon: LayoutDashboardIcon,
  },
  { id: 'outreach', label: 'Voter Outreach', icon: SendIcon },
  { id: 'voter-data', label: 'Voter Data', icon: UsersRoundIcon },
  { id: 'website', label: 'Website', icon: GlobeIcon },
  { id: 'ai-assistant', label: 'AI Assistant', icon: BotIcon },
  { id: 'content-builder', label: 'Content Builder', icon: FileTextIcon },
]

const ELECTED_OFFICE_ITEMS: NavItem[] = [
  { id: 'chief-of-staff', label: 'Chief of Staff', icon: SparklesIcon },
  { id: 'briefings', label: 'Briefing Assistant', icon: ClipboardListIcon },
  { id: 'polls', label: 'Polls', icon: SendIcon },
  { id: 'constituents', label: 'Constituent Data', icon: UsersRoundIcon },
]

const MODES: Record<
  Mode,
  { orgName: string; pro: boolean; items: NavItem[]; activeId: string }
> = {
  campaign: {
    orgName: '2025 Campaign',
    pro: true,
    items: CAMPAIGN_ITEMS,
    activeId: 'campaign-manager',
  },
  electedOffice: {
    orgName: 'Pittsboro Town Council',
    pro: false,
    items: ELECTED_OFFICE_ITEMS,
    activeId: 'briefings',
  },
}

const USER_NAME = 'Renee Wells'

const ACCOUNT_ITEMS = [
  { id: 'profile', label: 'Profile', icon: CircleUserRoundIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
  { id: 'account', label: 'Account', icon: UserCogIcon },
]

// Org switcher: heart + GoodParty.org (+ PRO) + org name + chevron, opening the
// org/run-for-office dropdown. Visual only — selecting an org doesn't navigate.
function OrgSwitcher({ mode }: { mode: Mode }) {
  const { orgName, pro } = MODES[mode]
  // Visual-only selection. Reset it when the Playground switches modes so the
  // checked org stays in sync with the trigger label (which derives from mode);
  // a render-phase reset avoids the stale-state flash a useEffect would cause.
  const [selected, setSelected] = useState(orgName)
  const [prevMode, setPrevMode] = useState(mode)
  if (prevMode !== mode) {
    setPrevMode(mode)
    setSelected(orgName)
  }
  return (
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
              {pro && <ProBadge size="small" />}
            </span>
            <span className="truncate text-sm font-semibold">{orgName}</span>
          </div>
          <ChevronDownIcon className="ml-auto size-4 shrink-0" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-72 rounded-lg"
        align="start"
        sideOffset={4}
      >
        <DropdownMenuRadioGroup value={selected} onValueChange={setSelected}>
          <DropdownMenuRadioItem value="2025 Campaign">
            <span className="flex-1">2025 Campaign</span>
            <span className="text-muted-foreground text-xs">Past</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="Pittsboro Town Council">
            <span className="flex-1">Pittsboro Town Council</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <span className="flex-1">Run for re-election</span>
          <ChevronRightIcon className="size-4" />
        </DropdownMenuItem>
        <DropdownMenuItem>
          <span className="flex-1">Run for a new office</span>
          <ChevronRightIcon className="size-4" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function NavList({ mode, isMobile }: { mode: Mode; isMobile: boolean }) {
  const { items, activeId } = MODES[mode]
  return (
    <SidebarMenu>
      {items.map(({ id, label, icon: Icon }) => (
        <SidebarMenuItem key={id}>
          <SidebarMenuButton
            isActive={id === activeId}
            className="h-10 gap-2 rounded-md px-4 py-2.5 text-sm"
          >
            <Icon size={16} />
            <span>{label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
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
          {ACCOUNT_ITEMS.map(({ id, label, icon: Icon }) => (
            <SidebarMenuItem key={id}>
              <SidebarMenuButton className="h-10 gap-2 rounded-md px-4 py-2.5 text-sm">
                <Icon size={16} />
                <span>{label}</span>
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

function UserFooter() {
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
                  {USER_NAME}
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
            {ACCOUNT_ITEMS.map(({ id, label, icon: Icon }) => (
              <DropdownMenuItem key={id}>
                <Icon size={16} className="text-foreground" />
                <span>{label}</span>
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

// Desktop frame: the always-visible rail beside an empty content area, wrapped in
// a bordered viewport so the viewer has a reference for the screen edges (mirrors
// the mobile frame). The frame fills the canvas height — `100svh` minus the global
// preview decorator's 1.5rem padding (top + bottom = 3rem) — so it reaches the
// viewport like the real nav while keeping that inset, and the footer is never cut
// off. `min-h-0` on the provider drops its default `min-h-svh`, which would
// otherwise overflow the padded canvas. (Frame/sizing is a Storybook-only device;
// the real Sidebar/SidebarInset use `h-svh`/`min-h-svh` and fill the viewport on
// their own.) The real rail is `hidden md:block` and collapses to a closed Sheet
// below the mobile breakpoint, so it would vanish on a narrow canvas — this renders
// the rail as a static column decoupled from that window-width detection.
// SidebarProvider stays because SidebarMenuButton reads it.
function DesktopFrame({ mode }: { mode: Mode }) {
  return (
    <SidebarProvider className="min-h-0">
      <div className="border-border flex h-[calc(100svh-3rem)] w-full max-w-[1100px] overflow-hidden rounded-xl border shadow-sm">
        <div className="bg-sidebar text-sidebar-foreground border-sidebar-border flex h-full w-64 flex-col border-r">
          <SidebarHeader>
            <OrgSwitcher mode={mode} />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <NavList mode={mode} isMobile={false} />
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <UserFooter />
          </SidebarFooter>
        </div>
        <div className="bg-background flex-1" />
      </div>
    </SidebarProvider>
  )
}

// Static mobile representation: a phone-width frame with the top bar and the
// drawer open. Decoupled from the Sidebar's window-width detection so it
// renders reliably at any screen size (no manual resize needed).
function MobileFrame({ mode }: { mode: Mode }) {
  const { activeId } = MODES[mode]
  const title =
    MODES[mode].items.find((i) => i.id === activeId)?.label ??
    'Campaign Manager'
  return (
    <SidebarProvider className="min-h-0">
      <div className="border-border relative h-[720px] w-[380px] overflow-hidden rounded-xl border shadow-sm">
        {/* base layer: top bar + content */}
        <div className="bg-sidebar text-sidebar-foreground border-sidebar-border flex h-16 items-center justify-between border-b px-4">
          <div className="flex min-w-0 items-center gap-3">
            <GoodPartyOrgLogo className="!h-[24px] !w-[30px]" />
            <h1 className="truncate text-base font-semibold">{title}</h1>
          </div>
          <button
            className="flex size-9 items-center justify-center rounded-full"
            aria-label="Open menu"
          >
            <MenuIcon size={20} />
          </button>
        </div>
        <div className="bg-background h-[calc(100%-4rem)]" />
        {/* scrim + open drawer */}
        <div className="absolute inset-0 z-40 bg-black/50" />
        <div className="bg-sidebar text-sidebar-foreground absolute inset-y-0 left-0 z-50 flex w-72 flex-col">
          <SidebarHeader>
            <OrgSwitcher mode={mode} />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <NavList mode={mode} isMobile />
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </div>
      </div>
    </SidebarProvider>
  )
}

const meta: Meta = {
  title: 'Patterns/Product Navigation',
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'A presentational mirror of the product navigation (dashboard rail + mobile drawer), built on the real `Sidebar` primitive with mock data. Use `mode` to switch between the campaign and elected-office configurations, and `device` to switch between the desktop rail and the mobile bar + drawer. Links and the org-switcher dropdown are visual only.',
      },
    },
  },
}

export default meta

type PlaygroundArgs = { mode: Mode; device: Device }

export const Playground: StoryObj<PlaygroundArgs> = {
  args: { mode: 'campaign', device: 'desktop' },
  argTypes: {
    mode: {
      control: 'inline-radio',
      options: ['campaign', 'electedOffice'],
      description:
        'Campaign (Pro) vs Elected Office (constituent) configuration.',
    },
    device: {
      control: 'inline-radio',
      options: ['desktop', 'mobile'],
      description: 'Desktop rail vs mobile bar + drawer.',
    },
  },
  render: ({ mode, device }) =>
    device === 'mobile' ? (
      <MobileFrame mode={mode} />
    ) : (
      <DesktopFrame mode={mode} />
    ),
}

export const Campaign: StoryObj = {
  parameters: { controls: { disable: true } },
  render: () => <DesktopFrame mode="campaign" />,
}

export const ElectedOffice: StoryObj = {
  parameters: { controls: { disable: true } },
  render: () => <DesktopFrame mode="electedOffice" />,
}

export const Mobile: StoryObj = {
  parameters: { controls: { disable: true } },
  render: () => <MobileFrame mode="campaign" />,
}

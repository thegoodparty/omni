'use client'
import Link from 'next/link'
import {
  MdAccountCircle,
  MdAutoAwesome,
  MdFactCheck,
  MdFileOpen,
  MdFolderShared,
  MdMenuBook,
  MdMessage,
  MdPeople,
  MdPoll,
} from 'react-icons/md'
import {
  Circle,
  CircleUserRound,
  ClipboardList,
  ExternalLink,
  FileText,
  LogOut,
  Send,
  Settings,
  Sparkles,
  UserRound,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useEcanvasser } from '@shared/hooks/useEcanvasser'
import { useEffect, useMemo } from 'react'
import { syncEcanvasser } from '@shared/utils/syncEcanvasser'
import Image from 'next/image'
import { useUser } from '@shared/hooks/useUser'
import { useUser as useClerkUser } from '@clerk/nextjs'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useElectedOffice } from '@shared/hooks/useElectedOffice'
import { CONTACTS_DATA_TITLE } from './contactsLabels'
// Labels and icons shared with each tab's page title bar (DashboardNavHeader),
// so the left rail and the top of the page can never read differently.
import { NAV_HEADER_ICONS, NAV_LABELS } from './navLabels'
import { CIRCLE_COMMUNITY_BASE } from 'appEnv'
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem as DropdownMenuItemComponent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem as SidebarMenuItemComponent,
  SidebarSeparator,
  useSidebar,
} from '@styleguide'
import {
  FlagIcon,
  MegaphoneIcon,
  ScrollTextIcon,
} from '@styleguide/components/ui/icons'
import {
  OrganizationPicker,
  useOrganization,
  useOrganizationRole,
} from '@shared/organization-picker'
import { useTeamAccountsFlag } from '@shared/experiments/teamAccountsFlag'

interface MenuItem {
  id: string
  label: string
  link: string
  icon: React.ReactNode
  v2Icon: LucideIcon
  v2Name?: string
  v2Category: 'campaign' | 'elected-office' | null
  onClick?: () => void
  target?: string
  isNew?: boolean
}

interface DashboardMenuProps {
  pathname: string | null
}

const VOTER_DATA_UPGRADE_ITEM: MenuItem = {
  label: 'Voter Data',
  icon: <MdFolderShared />,
  v2Icon: UsersRound,
  v2Category: 'campaign',
  link: '/dashboard/pro-upgrade',
  id: 'upgrade-pro-dashboard',
}

const DEFAULT_MENU_ITEMS: MenuItem[] = [
  {
    label: NAV_LABELS.campaignManager,
    icon: <MdFactCheck />,
    v2Icon: NAV_HEADER_ICONS.dashboard,
    link: '/dashboard',
    v2Category: 'campaign',
    id: 'campaign-tracker-dashboard',
    onClick: () => trackEvent(EVENTS.Navigation.Dashboard.ClickDashboard),
  },
  {
    label: NAV_LABELS.voterOutreach,
    icon: <MdMessage />,
    v2Icon: NAV_HEADER_ICONS.send,
    v2Category: 'campaign',
    link: '/dashboard/outreach',
    id: 'outreach-dashboard',
    onClick: () => trackEvent(EVENTS.Navigation.Dashboard.ClickVoterOutreach),
  },
  VOTER_DATA_UPGRADE_ITEM,
  {
    label: 'My Profile',
    icon: <MdAccountCircle />,
    v2Icon: Circle,
    v2Category: null,
    link: '/dashboard/profile',
    id: 'campaign-details-dashboard',
    onClick: () => trackEvent(EVENTS.Navigation.Dashboard.ClickMyProfile),
  },
  {
    label: 'Content Builder',
    icon: <MdFileOpen />,
    v2Icon: FileText,
    v2Category: 'campaign',
    link: '/dashboard/content',
    id: 'my-content-dashboard',
    onClick: () => trackEvent(EVENTS.Navigation.Dashboard.ClickContentBuilder),
  },

  {
    label: 'Community',
    icon: (
      <Image
        src="/images/logo/heart-white.svg"
        alt="Community"
        width={20}
        height={20}
        className="opacity-70 hover:opacity-100 transition-opacity"
      />
    ),
    v2Icon: Circle,
    v2Category: null,
    link: `${CIRCLE_COMMUNITY_BASE}/join?invitation_token=ee5c167c12e1335125a5c8dce7c493e95032deb7-a58159ab-64c4-422a-9396-b6925c225952`,
    target: '_blank',
    id: 'community-dashboard',
    onClick: () => trackEvent(EVENTS.Navigation.Dashboard.ClickCommunity),
  },
]

const CONTACTS_MENU_ITEM: MenuItem = {
  id: 'contacts-dashboard',
  label: 'Contacts',
  v2Name: CONTACTS_DATA_TITLE.serve,
  link: '/dashboard/contacts',
  icon: <MdPeople />,
  v2Icon: UsersRound,
  v2Category: 'elected-office',
  onClick: () => trackEvent(EVENTS.Navigation.Dashboard.ClickContacts),
}

// Win campaigns reuse the Serve Contacts route/components but are categorized
// as 'campaign', so they need their own item — the elected-office
// CONTACTS_MENU_ITEM is filtered out for campaign orgs (see the v2Category
// filter in NewNavMenu). Win reads "Voter Data", never "Constituents".
const WIN_CONTACTS_MENU_ITEM: MenuItem = {
  id: 'win-contacts-dashboard',
  label: 'Contacts',
  v2Name: CONTACTS_DATA_TITLE.win,
  link: '/dashboard/contacts',
  icon: <MdPeople />,
  v2Icon: UsersRound,
  v2Category: 'campaign',
  onClick: () => trackEvent(EVENTS.Navigation.Dashboard.ClickContacts),
}

const POLLS_MENU_ITEM: MenuItem = {
  id: 'polls-dashboard',
  label: 'Polls',
  link: '/dashboard/polls',
  icon: <MdPoll />,
  v2Icon: Send,
  v2Category: 'elected-office',
  onClick: () => trackEvent(EVENTS.Navigation.Dashboard.ClickPolls),
}

const CONSTITUENT_OUTREACH_MENU_ITEM: MenuItem = {
  id: 'constituent-outreach-dashboard',
  label: NAV_LABELS.constituentOutreach,
  link: '/dashboard/constituent-outreach',
  icon: <MdMessage />,
  v2Icon: MegaphoneIcon,
  v2Category: 'elected-office',
  onClick: () =>
    trackEvent(EVENTS.Navigation.Dashboard.ClickConstituentOutreach),
}

const BRIEFINGS_MENU_ITEM: MenuItem = {
  id: 'briefings-dashboard',
  label: 'Briefing Assistant',
  link: '/dashboard/briefings',
  icon: <MdFactCheck />,
  v2Icon: ClipboardList,
  v2Category: 'elected-office',
  onClick: () => trackEvent(EVENTS.Navigation.Dashboard.ClickBriefings),
}

const COMMUNITY_ISSUES_MENU_ITEM: MenuItem = {
  id: 'community-issues-dashboard',
  label: 'Community Issues',
  link: '/dashboard/community-issues',
  icon: <MdFactCheck />,
  v2Icon: FlagIcon,
  v2Category: 'elected-office',
  onClick: () => trackEvent(EVENTS.Navigation.Dashboard.ClickCommunityIssues),
}

const CHIEF_OF_STAFF_MENU_ITEM: MenuItem = {
  id: 'chief-of-staff-dashboard',
  label: 'Chief of Staff',
  link: '/dashboard/chief-of-staff',
  icon: <MdAutoAwesome />,
  v2Icon: Sparkles,
  v2Category: 'elected-office',
}

const PUBLIC_PROFILE_MENU_ITEM: MenuItem = {
  id: 'public-profile-dashboard',
  label: NAV_LABELS.publicProfile,
  link: '/dashboard/public-profile',
  icon: <MdFactCheck />,
  v2Icon: NAV_HEADER_ICONS.profile,
  v2Category: 'elected-office',
}

const ORDINANCES_MENU_ITEM: MenuItem = {
  id: 'ordinances-dashboard',
  label: 'Ordinances',
  link: '/dashboard/ordinances',
  icon: <MdFileOpen />,
  v2Icon: ScrollTextIcon,
  v2Category: 'elected-office',
}

const CAMPAIGN_PLAN_MENU_ITEM: MenuItem = {
  id: 'campaign-plan-dashboard',
  label: NAV_LABELS.campaignTracker,
  link: '/dashboard/campaign-plan',
  icon: <MdFileOpen />,
  v2Icon: NAV_HEADER_ICONS.scroll,
  v2Category: 'campaign',
  onClick: () => trackEvent(EVENTS.Navigation.Dashboard.ClickCampaignPlan),
}

const CAMPAIGN_STORY_MENU_ITEM: MenuItem = {
  id: 'campaign-story-dashboard',
  label: NAV_LABELS.campaignStory,
  link: '/dashboard/campaign-story',
  icon: <MdMenuBook />,
  v2Icon: NAV_HEADER_ICONS.book,
  v2Category: 'campaign',
}

// win-team-accounts (ENG-10816/10827). v2Category is set per-render (below)
// to match the current org type, the same way PUBLIC_PROFILE_MENU_ITEM is
// pushed twice for the two org types — Team is available to both.
const TEAM_MENU_ITEM: Omit<MenuItem, 'v2Category'> = {
  id: 'team-dashboard',
  label: NAV_LABELS.team,
  link: '/dashboard/team',
  icon: <MdPeople />,
  v2Icon: UsersRound,
  onClick: () => trackEvent(EVENTS.Navigation.Dashboard.ClickCampaignTeam),
}

const KNOW_YOUR_OPPONENT_MENU_ITEM: MenuItem = {
  id: 'race-opponent-dashboard',
  label: NAV_LABELS.knowYourOpponent,
  link: '/dashboard/race-opponent',
  icon: <MdFactCheck />,
  v2Icon: NAV_HEADER_ICONS.flag,
  v2Category: 'campaign',
}

export const getDashboardMenuItems = (
  isElectedOffice: boolean,
  isElectedOfficeLoading: boolean,
  showTeamItem = false,
): MenuItem[] => {
  const menuItems = [...DEFAULT_MENU_ITEMS]

  // Community Issues nav mirrors page-level access (serveAccess.ts): both are
  // elected-office existence alone.
  const communityIssuesShown = isElectedOffice
  const ordinancesShown = isElectedOffice

  const voterDataIndex = menuItems.indexOf(VOTER_DATA_UPGRADE_ITEM)
  if (isElectedOffice) {
    menuItems[voterDataIndex] = CONTACTS_MENU_ITEM
  } else if (!isElectedOfficeLoading) {
    // Hold off until the elected-office query settles — until then a Serve
    // elected-official reads as not-elected-office, so committing here would
    // swap the slot (placeholder → Contacts) as the query resolves. While not
    // ready, the generic upgrade placeholder holds the slot.
    //
    // Pro AND non-pro Win campaigns get the unified Contacts page — a non-pro
    // candidate sees the district aggregates and a blurred preview and is
    // upsold there (ENG-10495).
    menuItems[voterDataIndex] = WIN_CONTACTS_MENU_ITEM
  }
  if (isElectedOffice) {
    menuItems.splice(voterDataIndex, 0, POLLS_MENU_ITEM)
    menuItems.splice(voterDataIndex + 1, 0, CONSTITUENT_OUTREACH_MENU_ITEM)
    menuItems.unshift(BRIEFINGS_MENU_ITEM)
    if (communityIssuesShown) {
      menuItems.splice(1, 0, COMMUNITY_ISSUES_MENU_ITEM)
    }
    if (ordinancesShown) {
      menuItems.splice(communityIssuesShown ? 2 : 1, 0, ORDINANCES_MENU_ITEM)
    }
    // The office holder's editable public /people profile (Serve side of §4).
    menuItems.push(PUBLIC_PROFILE_MENU_ITEM)
  }

  // Chief of Staff is the primary Serve tab (Serve home), so it sits above
  // Briefing Assistant. Gated on the same elected-office check as the rest of
  // the Serve rail.
  const chiefOfStaffShown = isElectedOffice
  if (chiefOfStaffShown) {
    menuItems.unshift(CHIEF_OF_STAFF_MENU_ITEM)
  }

  // Campaign Manager (dashboard home) is index 0, pushed down by each item
  // unshifted above it: BRIEFINGS and COMMUNITY_ISSUES for an elected office,
  // then Chief of Staff when shown. Insert the Plan/Tracker item right after
  // Campaign Manager to render the campaign-category nav as [Campaign
  // Manager, Campaign Plan, …].
  const afterCampaignManager =
    1 +
    (isElectedOffice ? 1 : 0) +
    (communityIssuesShown ? 1 : 0) +
    (ordinancesShown ? 1 : 0) +
    (chiefOfStaffShown ? 1 : 0)

  // The campaign tracker tab, and the "Your story" tab just above it (the
  // story is what the tracker + plan are generated from).
  menuItems.splice(afterCampaignManager, 0, CAMPAIGN_PLAN_MENU_ITEM)
  menuItems.splice(afterCampaignManager, 0, CAMPAIGN_STORY_MENU_ITEM)

  // Visible to non-Pro users too: the page renders a locked upgrade view
  // rather than the feature — the content is gated on isPro at the route.
  menuItems.push(KNOW_YOUR_OPPONENT_MENU_ITEM)

  // Public Profile for Win candidates (campaign-category twin of the
  // elected-office item pushed above). The route resolves the product itself;
  // the category filter shows exactly one of the two per org type.
  menuItems.push({
    ...PUBLIC_PROFILE_MENU_ITEM,
    id: 'public-profile-campaign',
    v2Category: 'campaign',
  })

  if (showTeamItem) {
    menuItems.push({
      ...TEAM_MENU_ITEM,
      v2Category: isElectedOffice ? 'elected-office' : 'campaign',
    })
  }

  return menuItems
}

export default function DashboardMenu({
  pathname,
}: DashboardMenuProps): React.JSX.Element {
  const [campaign] = useCampaign()
  const [ecanvasser] = useEcanvasser()
  const { data: electedOffice, isLoading: isElectedOfficeLoading } =
    useElectedOffice()
  // trackExposure=false: this is a render-decision read, not the experiment's
  // treatment surface (the team page itself tracks exposure).
  const { enabled: teamAccountsEnabled } = useTeamAccountsFlag(false)

  const menuItems = useMemo(
    () =>
      getDashboardMenuItems(
        !!electedOffice,
        isElectedOfficeLoading,
        teamAccountsEnabled,
      ),
    [electedOffice, isElectedOfficeLoading, teamAccountsEnabled],
  )

  useEffect(() => {
    if (campaign && ecanvasser) {
      syncEcanvasser(campaign?.id)
    }
  }, [campaign, ecanvasser])

  return <NewNavMenu menuItems={menuItems} pathname={pathname} />
}

type AccountManagementItem = {
  label: string
  icon: LucideIcon
  id: string
  href: string
  onClick?: () => void
  _target?: string
}

const NewNavMenu = ({
  menuItems,
  pathname,
}: {
  menuItems: MenuItem[]
  pathname: string | null
}) => {
  const [user] = useUser()
  const { user: clerkUser, isLoaded: isClerkUserLoaded } = useClerkUser()
  const { setOpenMobile, isMobile } = useSidebar()

  const menuFirstName =
    (isClerkUserLoaded && clerkUser?.firstName?.trim()) || user?.firstName || ''
  const menuLastName =
    (isClerkUserLoaded && clerkUser?.lastName?.trim()) || user?.lastName || ''

  const organization = useOrganization()
  const organizationRole = useOrganizationRole()
  // ENG-10829: a manager (campaignAdmin) never sees billing/account-settings.
  // Owner (including every current solo user, since role is undefined until
  // teams exist) sees today's menu exactly.
  const isManager = organizationRole === 'campaignAdmin'

  const handleMenuItemClick = (item: MenuItem) => {
    item?.onClick?.()
    setOpenMobile(false)
  }

  const accountManagementMenuItems = {
    profile: {
      label: 'Profile',
      icon: CircleUserRound,
      id: 'nav-dash-profile',
      href: '/dashboard/profile',
      onClick: () => trackEvent(EVENTS.Navigation.Dashboard.ClickMyProfile),
    },
    account: {
      label: 'Account Settings',
      icon: Settings,
      id: 'nav-dash-account',
      href: '/dashboard/account',
    },
    community: {
      label: 'Community Forum',
      icon: ExternalLink,
      id: 'nav-dash-community',
      href: `${CIRCLE_COMMUNITY_BASE}/join?invitation_token=ee5c167c12e1335125a5c8dce7c493e95032deb7-a58159ab-64c4-422a-9396-b6925c225952`,
      _target: '_blank',
    },
    logout: {
      label: 'Logout',
      icon: LogOut,
      id: 'nav-log-out',
      href: '/logout',
      _target: '_self',
    },
  } satisfies Record<string, AccountManagementItem>

  const sidebarItem = (item: AccountManagementItem) => (
    <SidebarMenuItemComponent key={item.id}>
      <SidebarMenuButton
        asChild
        isActive={pathname === item.href}
        className="px-4 py-2.5 h-10 text-sm gap-2 rounded-md font-opensans"
      >
        <Link
          href={item.href}
          id={item.id}
          target={item._target}
          onClick={() => {
            item.onClick?.()
            setOpenMobile(false)
          }}
        >
          <item.icon size={16} />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItemComponent>
  )

  const dropDownItem = (item: AccountManagementItem) => (
    <DropdownMenuItemComponent asChild className="h-10">
      <Link
        href={item.href}
        id={item.id}
        target={item._target}
        onClick={() => {
          item.onClick?.()
        }}
      >
        <item.icon size={16} className="text-foreground" />
        <span>{item.label}</span>
      </Link>
    </DropdownMenuItemComponent>
  )

  return (
    <>
      <SidebarHeader>
        <OrganizationPicker />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems
                .filter((i) =>
                  organization?.electedOfficeId
                    ? i.v2Category === 'elected-office'
                    : i.v2Category === 'campaign',
                )
                .map((item) => {
                  const {
                    id,
                    link,
                    label,
                    target,
                    isNew,
                    v2Icon: V2Icon,
                  } = item
                  return (
                    <SidebarMenuItemComponent key={id}>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname === link}
                        className="px-4 py-2.5 h-10 text-sm gap-2 rounded-md font-opensans"
                      >
                        <Link
                          href={link}
                          id={id}
                          target={target}
                          onClick={() => handleMenuItemClick(item)}
                        >
                          {V2Icon && <V2Icon size={16} />}
                          <span>{item.v2Name || label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {isNew && (
                        <SidebarMenuBadge className="bg-blue-500 text-white text-xs font-semibold rounded px-1.5 mt-1 mx-4">
                          NEW
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItemComponent>
                  )
                })}
              {isMobile && (
                <>
                  <SidebarSeparator />
                  {sidebarItem(accountManagementMenuItems.community)}
                  <SidebarSeparator />
                  {sidebarItem(accountManagementMenuItems.profile)}
                  {!isManager &&
                    sidebarItem(accountManagementMenuItems.account)}
                  <SidebarSeparator />
                  {sidebarItem(accountManagementMenuItems.logout)}
                  <SidebarSeparator />
                </>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {!isMobile && (
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItemComponent>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton className="h-auto gap-2 p-2 font-opensans data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                    <Avatar className="size-8 shrink-0 rounded-lg border border-border">
                      <Avatar.Image src={user?.avatar || undefined} />
                      <Avatar.Fallback className="rounded-lg bg-white">
                        <UserRound className="size-5 text-muted-foreground" />
                      </Avatar.Fallback>
                    </Avatar>
                    <div className="flex flex-1 flex-col gap-0.5 min-w-0 leading-none text-left">
                      <span
                        data-testid="user-menu-name"
                        className="truncate text-sm font-semibold"
                      >
                        {menuFirstName} {menuLastName}
                      </span>
                      <span className="truncate text-xs">Manage account</span>
                    </div>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="min-w-56 rounded-lg font-opensans"
                  side={isMobile ? 'bottom' : 'right'}
                  align="end"
                  sideOffset={4}
                >
                  {dropDownItem(accountManagementMenuItems.profile)}
                  {!isManager &&
                    dropDownItem(accountManagementMenuItems.account)}
                  <DropdownMenuSeparator />
                  {dropDownItem(accountManagementMenuItems.community)}
                  <DropdownMenuSeparator />
                  {dropDownItem(accountManagementMenuItems.logout)}
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItemComponent>
          </SidebarMenu>
        </SidebarFooter>
      )}
    </>
  )
}

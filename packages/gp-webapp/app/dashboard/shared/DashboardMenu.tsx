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
  MdSensorDoor,
} from 'react-icons/md'
import {
  Circle,
  CircleUserRound,
  ClipboardList,
  DoorClosed,
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
import { useCampaignStrategyExists } from './useCampaignStrategyExists'
import { useElectedOffice } from '@shared/hooks/useElectedOffice'
import { useNativeDoorKnockingFlag } from 'app/shared/experiments/nativeDoorKnockingFlag'
import { useDistrictResolution } from './useDistrictResolution'
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
import { FlagIcon, ScrollTextIcon } from '@styleguide/components/ui/icons'
import {
  OrganizationPicker,
  useOrganization,
} from '@shared/organization-picker'
import { useFlagOn } from '@shared/experiments/FeatureFlagsProvider'
import { useCampaignStoryFlag } from '@shared/experiments/campaignStoryFlag'

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

const DOOR_KNOCKING_MENU_ITEM: MenuItem = {
  id: 'door-knocking-dashboard',
  label: 'Door Knocking',
  link: '/dashboard/door-knocking',
  icon: <MdSensorDoor />,
  v2Icon: DoorClosed,
  v2Category: 'campaign',
  onClick: () => trackEvent(EVENTS.Navigation.Dashboard.ClickDoorKnocking),
}

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
  label: NAV_LABELS.campaignPlan,
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

const KNOW_YOUR_OPPONENT_MENU_ITEM: MenuItem = {
  id: 'race-opponent-dashboard',
  label: NAV_LABELS.knowYourOpponent,
  link: '/dashboard/race-opponent',
  icon: <MdFactCheck />,
  v2Icon: NAV_HEADER_ICONS.flag,
  v2Category: 'campaign',
}

// Which of the two door-knocking products the candidate would actually land on.
// `nativeEnabled` is the flag's settled value, so it matches what
// DoorKnockingPageGate decides on the page itself. `proAccess` is the CRM's
// canUseProFeatures (isPro OR elected office), which is the same predicate
// gp-api's ContactsService.assertProAccess enforces on every native route.
interface DoorKnockingNavGate {
  ecanvasserConnected: boolean
  nativeEnabled: boolean
  districtResolvable: boolean
  proAccess: boolean
}

export const getDashboardMenuItems = (
  serveAccessEnabled: boolean,
  isElectedOffice: boolean,
  isElectedOfficeLoading: boolean,
  campaignStrategyExists: boolean,
  campaignStoryEnabled: boolean,
  communityIssuesEnabled: boolean,
  ordinancesEnabled: boolean,
  doorKnocking: DoorKnockingNavGate = {
    ecanvasserConnected: false,
    nativeEnabled: false,
    districtResolvable: false,
    proAccess: false,
  },
): MenuItem[] => {
  const menuItems = [...DEFAULT_MENU_ITEMS]

  // Community Issues nav is gated behind serve-community-issues-v1 so it can be
  // dark-launched independently; the page route itself is serve-access gated.
  const communityIssuesShown = isElectedOffice && communityIssuesEnabled
  const ordinancesShown = isElectedOffice && ordinancesEnabled

  const voterDataIndex = menuItems.indexOf(VOTER_DATA_UPGRADE_ITEM)
  if (serveAccessEnabled && isElectedOffice) {
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
  // Briefing Assistant. Gated on the same serve-access + elected-office check.
  const chiefOfStaffShown = serveAccessEnabled && isElectedOffice
  if (chiefOfStaffShown) {
    menuItems.unshift(CHIEF_OF_STAFF_MENU_ITEM)
  }

  // Campaign Manager (dashboard home) is index 0, pushed down by each item
  // unshifted above it: BRIEFINGS for an elected office, COMMUNITY_ISSUES when
  // its flag is on, then Chief of Staff when shown. Insert the Plan/Tracker
  // item right after Campaign Manager to render the campaign-category nav as
  // [Campaign Manager, Campaign Plan, …].
  const afterCampaignManager =
    1 +
    (isElectedOffice ? 1 : 0) +
    (communityIssuesShown ? 1 : 0) +
    (ordinancesShown ? 1 : 0) +
    (chiefOfStaffShown ? 1 : 0)

  // Gated on the dedicated existence endpoint, NOT campaign.hasCampaignStrategy
  // — the cached campaign object gets overwritten by responses that lack that
  // computed field (see useCampaignStrategyExists). Campaign-story users see
  // the tab even before a plan exists: it hosts the "complete your story to
  // generate a plan" gate.
  if (campaignStrategyExists || campaignStoryEnabled) {
    // The story cohort gets the campaign tracker on this page, so label it as
    // such; the legacy (story-off) cohort still sees the plan content there.
    menuItems.splice(afterCampaignManager, 0, {
      ...CAMPAIGN_PLAN_MENU_ITEM,
      label: campaignStoryEnabled
        ? NAV_LABELS.campaignTracker
        : CAMPAIGN_PLAN_MENU_ITEM.label,
    })
  }

  // Story-cohort users get a "Your story" tab just above the tracker (the story
  // is what the tracker + plan are generated from).
  if (campaignStoryEnabled) {
    menuItems.splice(afterCampaignManager, 0, CAMPAIGN_STORY_MENU_ITEM)
  }

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

  // Mirror DoorKnockingPageGate: with the flag on, the route renders the native
  // voter map and an eCanvasser record is irrelevant; with it off (or
  // unsettled) it renders the legacy eCanvasser dashboard, which is only worth
  // linking to for an integrated org. Gating on eCanvasser alone hid the native
  // pilot from every candidate who never integrated it. The native map also
  // needs a resolvable district — every pack and turf read 400s without one —
  // and, since ENG-10888, Pro: every native route is entitlement-gated in
  // gp-api, so without it the link leads only to an upgrade prompt. Unlike
  // Know Your Opponent, which advertises itself to non-Pro candidates, this
  // stays hidden — routing spends real vendor credits per knock, so the pitch
  // does not belong in a nav entry the pilot allowlist already scopes.
  // The control branch is deliberately untouched: flag-off users keep the
  // eCanvasser experience on the same terms as before.
  //
  // `proAccess` folds in elected office, so it reads false while that query is
  // in flight and this item appears once it settles. Unlike the Contacts slot
  // above there is nothing to hold — the item is appended, so waiting for the
  // query and hiding during it are the same behavior. Resolving the other way
  // (assume access until refused) would flash a Pro-only link at every non-Pro
  // Win candidate, which is the thing this entry is hidden to avoid; the page
  // gate, which can show a real loading state, is where that wait belongs.
  const doorKnockingShown = doorKnocking.nativeEnabled
    ? doorKnocking.districtResolvable && doorKnocking.proAccess
    : doorKnocking.ecanvasserConnected
  if (doorKnockingShown) {
    menuItems.push(DOOR_KNOCKING_MENU_ITEM)
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
  const { ready: _flagsReady, on: serveAccessEnabled } =
    useFlagOn('serve-access')
  // Menu isn't the treatment surface (the page's FeatureFlagGuard is), so
  // don't track exposure here.
  const { enabled: campaignStoryEnabled } = useCampaignStoryFlag(false)
  // Nav-only gate for the Community Issues tab; mirrors the serve-access read.
  const { on: communityIssuesEnabled } = useFlagOn('serve-community-issues-v1')
  // Nav-only gate for the Ordinances tab; the page's FeatureFlagGuard is the
  // treatment surface.
  const { on: ordinancesEnabled } = useFlagOn('serve-ordinances')
  // The page's gate is the treatment surface, so read without tracking exposure.
  const { ready: nativeDoorKnockingReady, enabled: nativeDoorKnockingEnabled } =
    useNativeDoorKnockingFlag(false)
  const { isUnresolvable: isDistrictUnresolvable } = useDistrictResolution()
  const campaignStrategyExists = useCampaignStrategyExists()

  const menuItems = useMemo(
    () =>
      getDashboardMenuItems(
        serveAccessEnabled,
        !!electedOffice,
        isElectedOfficeLoading,
        campaignStrategyExists,
        campaignStoryEnabled,
        communityIssuesEnabled,
        ordinancesEnabled,
        {
          ecanvasserConnected: !!ecanvasser,
          nativeEnabled: nativeDoorKnockingReady && nativeDoorKnockingEnabled,
          districtResolvable: !isDistrictUnresolvable,
          proAccess: !!campaign?.isPro || !!electedOffice,
        },
      ),
    [
      serveAccessEnabled,
      ecanvasser,
      electedOffice,
      isElectedOfficeLoading,
      campaignStrategyExists,
      campaignStoryEnabled,
      communityIssuesEnabled,
      ordinancesEnabled,
      nativeDoorKnockingReady,
      nativeDoorKnockingEnabled,
      isDistrictUnresolvable,
      campaign,
    ],
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
                  {sidebarItem(accountManagementMenuItems.account)}
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
                  {dropDownItem(accountManagementMenuItems.account)}
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

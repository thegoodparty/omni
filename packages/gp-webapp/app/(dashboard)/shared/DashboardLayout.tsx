'use client'
import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import DashboardMenu from './DashboardMenu'
import DashboardNavHeader from './DashboardNavHeader'
import { NavHeaderActionSlotContext } from './DashboardNavHeaderAction'
import { NAV_LABELS, type NavHeaderIconKey } from './navLabels'
import { useUser } from '@shared/hooks/useUser'
import { useCampaign } from '@shared/hooks/useCampaign'
import { ProUpgradePrompt } from './ProUpgradePrompt'
import { usePathname, useRouter } from 'next/navigation'
import { weeksTill } from 'helpers/dateHelper'
import { Campaign } from 'helpers/types'
import {
  IconButton,
  Separator,
  Sidebar,
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from '@styleguide'
import {
  MenuIcon,
  MessagesSquareIcon,
  XMarkIcon,
} from '@styleguide/components/ui/icons'
import { useOrganization } from '@shared/organization-picker'
import ImpersonationBanner from '@shared/user/ImpersonationBanner'
import { ElectedOfficeTermDatesModalController } from './ElectedOfficeTermDatesModalController'
import { useIsImpersonating } from '@shared/hooks/useIsImpersonating'
import { isElectionResultDismissed } from '../election-result/dismissal'
import { CONTACTS_DATA_TITLE } from './contactsLabels'
import { useWinVoterContext } from './useWinVoterContext'
import { MembershipChip } from './membership/MembershipChip'
import {
  DashboardCampaignManagerChat,
  useCampaignManagerChat,
} from '../campaign-manager/CampaignManagerChatProvider'

export interface DashboardNavHeaderConfig {
  // Omitted = label-only bar (the Voter Outreach design carries no icon).
  icon?: NavHeaderIconKey
  label: string
  centered?: boolean
}

interface DashboardLayoutProps {
  children: ReactNode
  pathname?: string
  campaign?: Campaign | null
  showAlert?: boolean
  wrapperClassName?: string
  hideMenu?: boolean
  // Drops the campaign-manager chat dock for a route that owns the bottom of
  // the viewport itself. Door knocking's walk is one: its person sheet ends in
  // the knock-log footer — the "Did they answer?" ladder and the not-a-voter
  // control — and the dock's fixed bar paints over exactly that strip, leaving
  // a canvasser standing at a door with no control to record what happened.
  // Same class of conflict as the Serve orgs DashboardCampaignManagerChat
  // already skips. Separate from `hideMenu` on purpose: website/create,
  // website/domain, website/editor and purchase all hide the menu and are
  // entitled to the manager, so one flag for both would take the dock off four
  // routes that never asked.
  hideChatDock?: boolean
  navHeader?: DashboardNavHeaderConfig
}

const DashboardLayout = ({
  children,
  pathname = '',
  campaign,
  wrapperClassName = '',
  hideMenu = false,
  hideChatDock = false,
  navHeader,
}: DashboardLayoutProps): React.JSX.Element | null => {
  const [user] = useUser()
  const [hookCampaign] = useCampaign()
  const organization = useOrganization()
  const router = useRouter()
  const hookPathname = usePathname()
  const isImpersonating = useIsImpersonating()
  const [navHeaderActionSlot, setNavHeaderActionSlot] =
    useState<HTMLDivElement | null>(null)
  // Whether a DashboardNavHeaderAction is mounted right now. Observed rather
  // than declared by the page: these CTAs come and go with page state, and the
  // bar needs the live answer to decide whether to render on mobile.
  const [navHeaderActionCount, setNavHeaderActionCount] = useState(0)
  const showNavHeader =
    !!organization?.electedOfficeId || navHeaderActionCount > 0
  const registerNavHeaderAction = useCallback(
    (delta: number) => setNavHeaderActionCount((count) => count + delta),
    [],
  )
  const navHeaderActionSlotValue = useMemo(
    () => ({
      element: navHeaderActionSlot,
      register: registerNavHeaderAction,
    }),
    [navHeaderActionSlot, registerNavHeaderAction],
  )

  const currentPath = pathname || hookPathname
  const activeCampaign = campaign || hookCampaign
  const details = activeCampaign?.details
  const goals =
    activeCampaign && 'goals' in activeCampaign
      ? activeCampaign.goals
      : undefined
  const goalsObj = goals && typeof goals === 'object' ? goals : null
  const goalsElectionDate =
    goalsObj &&
    'electionDate' in goalsObj &&
    typeof goalsObj.electionDate === 'string'
      ? goalsObj.electionDate
      : undefined
  const electionDate = details?.electionDate || goalsElectionDate

  useEffect(() => {
    if (currentPath?.startsWith('/election-result')) {
      return
    }

    // An impersonating admin can dismiss the forced election-result gate
    // without answering it; don't bounce them back to it for the rest of
    // the session.
    if (isImpersonating && isElectionResultDismissed()) {
      return
    }

    const weeksResult = weeksTill(electionDate)
    const shouldRedirect =
      typeof details?.wonGeneral !== 'boolean' &&
      weeksResult &&
      typeof weeksResult === 'object' &&
      weeksResult.weeks < 0

    if (shouldRedirect) {
      router.push('/election-result')
    }
  }, [currentPath, details?.wonGeneral, electionDate, router, isImpersonating])

  const pageBody = (
    <div className={`flex flex-1 flex-col p-2 md:p-4 ${wrapperClassName}`}>
      <ProUpgradePrompt
        campaign={activeCampaign}
        user={user}
        pathname={currentPath || undefined}
        isElectedOffice={!!organization?.electedOfficeId}
      />
      {children}
    </div>
  )

  // The chat wraps the sidebar and the top bar as well as the page: on Win its
  // way in is the sidebar's Chat pill (or the mobile top bar), not a bar over
  // the page.
  const shell = (
    <>
      {!hideMenu && (
        <Sidebar>
          <DashboardMenu pathname={currentPath} />
        </Sidebar>
      )}
      {/* Win pages share the sidebar's background so the app reads as one
          surface; Serve keeps its own page grey. */}
      <SidebarInset
        className={
          organization?.electedOfficeId ? 'bg-[#f5f5f5]' : 'bg-sidebar'
        }
      >
        {!hideMenu && <MobileMenuTrigger />}
        <ImpersonationBanner />
        <ElectedOfficeTermDatesModalController />
        {/* Win drops the title bar unless the page puts an action in it: the
            sidebar's current-page state says where you are. The page keeps a
            screen-reader heading. Serve keeps the bar. */}
        {navHeader && !showNavHeader && (
          <h1 className="sr-only">{navHeader.label}</h1>
        )}
        {navHeader && showNavHeader && (
          <DashboardNavHeader
            icon={navHeader.icon}
            label={navHeader.label}
            centered={navHeader.centered}
            hasAction={navHeaderActionCount > 0}
            actionSlotRef={setNavHeaderActionSlot}
          />
        )}
        <NavHeaderActionSlotContext.Provider value={navHeaderActionSlotValue}>
          {pageBody}
        </NavHeaderActionSlotContext.Provider>
      </SidebarInset>
    </>
  )

  return (
    <SidebarProvider>
      {hideChatDock ? (
        shell
      ) : (
        <DashboardCampaignManagerChat>{shell}</DashboardCampaignManagerChat>
      )}
    </SidebarProvider>
  )
}

// The full-bleed DashboardNavHeader is desktop-only, so on mobile the tab title
// is shown here in the top bar instead. Any route that renders a navHeader (or
// IssuesNavHeader) needs a matching entry so its title survives on mobile.
const MOBILE_PAGE_TITLES: Array<[string, string]> = [
  ['/chief-of-staff', 'Chief of Staff'],
  ['/briefings', 'Briefing Assistant'],
  ['/community-issues', 'Community Issues'],
  ['/public-profile', NAV_LABELS.publicProfile],
  ['/ordinances', 'Ordinances'],
  ['/priorities', NAV_LABELS.priorities],
  ['/constituent-outreach', NAV_LABELS.constituentOutreach],
  ['/race-opponent', NAV_LABELS.knowYourOpponent],
  ['/outreach', NAV_LABELS.voterOutreach],
  ['/campaign-verification', 'Campaign verification'],
  // /contacts is intentionally absent: its title depends on Win vs
  // Serve, so MobileMenuTrigger resolves it from the org instead.
  ['/polls', 'Polls'],
  ['/website', 'Website'],
  ['/profile', 'My Profile'],
  ['/account', 'Account Settings'],
  ['/door-knocking', 'Door Knocking'],
  ['/team', NAV_LABELS.team],
]

const isContactsPath = (pathname: string): boolean =>
  pathname === '/contacts' || pathname.startsWith('/contacts/')

const getMobilePageTitle = (pathname: string | null): string | null => {
  if (!pathname) return null
  // Exact matches, ahead of the table.
  if (pathname === '/home') return NAV_LABELS.home
  if (pathname === '/campaign-plan') {
    return NAV_LABELS.campaignPlan
  }
  for (const [prefix, title] of MOBILE_PAGE_TITLES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return title
  }
  return null
}

const MobileMenuTrigger = () => {
  const { setOpenMobile, openMobile } = useSidebar()
  const pathname = usePathname()
  // Win's chat lives in the sidebar on desktop; a phone's sidebar is a closed
  // drawer, so the top bar carries it. Home has its own chat box.
  const chat = useCampaignManagerChat()
  // The Contacts route is shared: Win reads "Voter Data", Serve reads
  // "Constituent Data". Use the same Win/Serve source as the page body
  // (useWinVoterContext) so the header and content always agree — and wait for
  // isReady so a Win user never flashes "Constituent Data" during load.
  const { isWin, isReady } = useWinVoterContext()
  const pageTitle =
    pathname && isContactsPath(pathname)
      ? isReady
        ? CONTACTS_DATA_TITLE[isWin ? 'win' : 'serve']
        : null
      : getMobilePageTitle(pathname)
  return (
    <>
      <div className="flex lg:hidden items-center justify-between h-16 px-4 bg-sidebar border-b border-sidebar-border">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/home" className="shrink-0">
            <img
              src="/images/logo/heart.svg"
              alt="GoodParty.org"
              className="h-6 w-8 object-contain"
            />
          </Link>
          {pageTitle && (
            <>
              {/* Same logo | title divider anatomy as the styleguide's
                  PageHeader (which this hand-rolled bar predates). */}
              <Separator
                orientation="vertical"
                className="data-[orientation=vertical]:h-5"
              />
              <h1 className="truncate text-base font-semibold text-foreground">
                {pageTitle}
              </h1>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {chat && pathname !== '/home' && (
            <IconButton
              type="button"
              variant="ghost"
              className="size-9"
              onClick={chat.openManager}
              aria-label="Open chat"
            >
              <MessagesSquareIcon className="size-5" aria-hidden />
            </IconButton>
          )}
          <MembershipChip />
          <button
            data-testid="mobile-menu-trigger"
            onClick={() => setOpenMobile(true)}
            className="flex items-center justify-center rounded-full size-9"
            aria-label="Open menu"
          >
            <MenuIcon size={20} />
          </button>
        </div>
      </div>
      {openMobile && (
        <button
          onClick={() => setOpenMobile(false)}
          className="fixed z-[60] top-3 right-3.5 flex items-center justify-center size-10 rounded-full bg-white shadow-md"
          aria-label="Close menu"
        >
          <XMarkIcon size={20} />
        </button>
      )}
    </>
  )
}

export default DashboardLayout

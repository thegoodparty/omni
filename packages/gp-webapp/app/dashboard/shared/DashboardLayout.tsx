'use client'
import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import DashboardMenu from './DashboardMenu'
import DashboardNavHeader from './DashboardNavHeader'
import { NavHeaderActionSlotContext } from './DashboardNavHeaderAction'
import { NAV_LABELS, type NavHeaderIconKey } from './navLabels'
import { EcanvasserProvider } from '@shared/hooks/EcanvasserProvider'
import { useUser } from '@shared/hooks/useUser'
import { useCampaign } from '@shared/hooks/useCampaign'
import { ProUpgradePrompt } from './ProUpgradePrompt'
import { usePathname, useRouter } from 'next/navigation'
import { weeksTill } from 'helpers/dateHelper'
import { Campaign } from 'helpers/types'
import {
  Separator,
  Sidebar,
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from '@styleguide'
import { MenuIcon, XMarkIcon } from '@styleguide/components/ui/icons'
import { useOrganization } from '@shared/organization-picker'
import ImpersonationBanner from '@shared/user/ImpersonationBanner'
import { ElectedOfficeTermDatesModalController } from './ElectedOfficeTermDatesModalController'
import { useIsImpersonating } from '@shared/hooks/useIsImpersonating'
import { isElectionResultDismissed } from '../election-result/dismissal'
import { CONTACTS_DATA_TITLE } from './contactsLabels'
import { useWinVoterContext } from './useWinVoterContext'
import { DashboardCampaignManagerChat } from '../campaign-manager/CampaignManagerChatProvider'

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
    if (currentPath?.startsWith('/dashboard/election-result')) {
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
      router.push('/dashboard/election-result')
    }
  }, [currentPath, details?.wonGeneral, electionDate, router, isImpersonating])

  const pageBody = (
    <div className={`flex-1 p-2 md:p-4 ${wrapperClassName}`}>
      <ProUpgradePrompt
        campaign={activeCampaign}
        user={user}
        pathname={currentPath || undefined}
        isElectedOffice={!!organization?.electedOfficeId}
      />
      {children}
    </div>
  )

  return (
    <EcanvasserProvider>
      <SidebarProvider>
        {!hideMenu && (
          <Sidebar>
            <DashboardMenu pathname={currentPath} />
          </Sidebar>
        )}
        <SidebarInset className="bg-[#f5f5f5]">
          {!hideMenu && <MobileMenuTrigger />}
          <ImpersonationBanner />
          <ElectedOfficeTermDatesModalController />
          {navHeader && (
            <DashboardNavHeader
              icon={navHeader.icon}
              label={navHeader.label}
              centered={navHeader.centered}
              hasAction={navHeaderActionCount > 0}
              actionSlotRef={setNavHeaderActionSlot}
            />
          )}
          <NavHeaderActionSlotContext.Provider value={navHeaderActionSlotValue}>
            {hideChatDock ? (
              pageBody
            ) : (
              <DashboardCampaignManagerChat>
                {pageBody}
              </DashboardCampaignManagerChat>
            )}
          </NavHeaderActionSlotContext.Provider>
        </SidebarInset>
      </SidebarProvider>
    </EcanvasserProvider>
  )
}

// The full-bleed DashboardNavHeader is desktop-only, so on mobile the tab title
// is shown here in the top bar instead. Any route that renders a navHeader (or
// IssuesNavHeader) needs a matching entry so its title survives on mobile.
const MOBILE_PAGE_TITLES: Array<[string, string]> = [
  ['/dashboard/chief-of-staff', 'Chief of Staff'],
  ['/dashboard/briefings', 'Briefing Assistant'],
  ['/dashboard/community-issues', 'Community Issues'],
  ['/dashboard/public-profile', NAV_LABELS.publicProfile],
  ['/dashboard/ordinances', 'Ordinances'],
  ['/dashboard/constituent-outreach', NAV_LABELS.constituentOutreach],
  ['/dashboard/race-opponent', NAV_LABELS.knowYourOpponent],
  ['/dashboard/campaign-story', NAV_LABELS.campaignStory],
  ['/dashboard/outreach', NAV_LABELS.voterOutreach],
  // /dashboard/contacts is intentionally absent: its title depends on Win vs
  // Serve, so MobileMenuTrigger resolves it from the org instead.
  ['/dashboard/polls', 'Polls'],
  ['/dashboard/website', 'Website'],
  ['/dashboard/profile', 'My Profile'],
  ['/dashboard/account', 'Account Settings'],
  ['/dashboard/content', 'Content Builder'],
  ['/dashboard/door-knocking', 'Door Knocking'],
]

const isContactsPath = (pathname: string): boolean =>
  pathname === '/dashboard/contacts' ||
  pathname.startsWith('/dashboard/contacts/')

const getMobilePageTitle = (pathname: string | null): string | null => {
  if (!pathname) return null
  // Exact matches, ahead of the table: a '/dashboard' entry in it would
  // prefix-match (and mistitle) every dashboard subroute that isn't listed.
  if (pathname === '/dashboard') return NAV_LABELS.campaignManager
  if (pathname === '/dashboard/campaign-plan') {
    return NAV_LABELS.campaignTracker
  }
  for (const [prefix, title] of MOBILE_PAGE_TITLES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return title
  }
  return null
}

const MobileMenuTrigger = () => {
  const { setOpenMobile, openMobile } = useSidebar()
  const pathname = usePathname()
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
          <Link href="/dashboard" className="shrink-0">
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
        <button
          data-testid="mobile-menu-trigger"
          onClick={() => setOpenMobile(true)}
          className="flex items-center justify-center rounded-full size-9"
          aria-label="Open menu"
        >
          <MenuIcon size={20} />
        </button>
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

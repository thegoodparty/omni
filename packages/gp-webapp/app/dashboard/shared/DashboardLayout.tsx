'use client'
import { ReactNode, useEffect } from 'react'
import Link from 'next/link'
import DashboardMenu from './DashboardMenu'
import DashboardNavHeader, { type NavHeaderIconKey } from './DashboardNavHeader'
import { EcanvasserProvider } from '@shared/hooks/EcanvasserProvider'
import { useUser } from '@shared/hooks/useUser'
import { useCampaign } from '@shared/hooks/useCampaign'
import { ProUpgradePrompt } from './ProUpgradePrompt'
import { usePathname, useRouter } from 'next/navigation'
import { weeksTill } from 'helpers/dateHelper'
import { Campaign } from 'helpers/types'
import { Sidebar, SidebarInset, SidebarProvider, useSidebar } from '@styleguide'
import { MenuIcon, XMarkIcon } from '@styleguide/components/ui/icons'
import { useOrganization } from '@shared/organization-picker'
import ImpersonationBanner from '@shared/user/ImpersonationBanner'
import { ElectedOfficeTermDatesModalController } from './ElectedOfficeTermDatesModalController'
import { useIsImpersonating } from '@shared/hooks/useIsImpersonating'
import { isElectionResultDismissed } from '../election-result/dismissal'
import { CONTACTS_DATA_TITLE } from './contactsLabels'
import { useWinVoterContext } from './useWinVoterContext'

interface DashboardLayoutProps {
  children: ReactNode
  pathname?: string
  campaign?: Campaign | null
  showAlert?: boolean
  wrapperClassName?: string
  hideMenu?: boolean
  navHeader?: { icon: NavHeaderIconKey; label: string; centered?: boolean }
}

const DashboardLayout = ({
  children,
  pathname = '',
  campaign,
  wrapperClassName = '',
  hideMenu = false,
  navHeader,
}: DashboardLayoutProps): React.JSX.Element | null => {
  const [user] = useUser()
  const [hookCampaign] = useCampaign()
  const organization = useOrganization()
  const router = useRouter()
  const hookPathname = usePathname()
  const isImpersonating = useIsImpersonating()

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
            />
          )}
          <div className={`flex-1 p-2 md:p-4 ${wrapperClassName}`}>
            <ProUpgradePrompt
              campaign={activeCampaign}
              user={user}
              pathname={currentPath || undefined}
              isElectedOffice={!!organization?.electedOfficeId}
            />
            {children}
          </div>
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
  ['/dashboard/race-opponent', 'Know your opponent'],
  ['/dashboard/outreach', 'Voter Outreach'],
  ['/dashboard/voter-records', 'Voter Data'],
  // /dashboard/contacts is intentionally absent: its title depends on Win vs
  // Serve, so MobileMenuTrigger resolves it from the org instead.
  ['/dashboard/polls', 'Polls'],
  ['/dashboard/website', 'Website'],
  ['/dashboard/profile', 'My Profile'],
  ['/dashboard/account', 'Account Settings'],
  ['/dashboard/campaign-assistant', 'AI Assistant'],
  ['/dashboard/content', 'Content Builder'],
  ['/dashboard/door-knocking', 'Door Knocking'],
]

const isContactsPath = (pathname: string): boolean =>
  pathname === '/dashboard/contacts' ||
  pathname.startsWith('/dashboard/contacts/')

const getMobilePageTitle = (pathname: string | null): string | null => {
  if (!pathname) return null
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
            <h1 className="truncate text-base font-semibold text-foreground">
              {pageTitle}
            </h1>
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

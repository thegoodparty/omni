'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  MANAGED_CIVIC_PANEL_BACKED_OUT_MESSAGE,
  MANAGED_CIVIC_PANEL_EXHAUSTED_MESSAGE,
  MANAGED_CIVIC_PANEL_SET_UP_MESSAGE,
  START_MANAGED_CIVIC_PANEL_MESSAGE,
} from '@goodparty_org/contracts'
import { useUser } from '@shared/hooks/useUser'
import { useOrganization } from '@shared/organization-picker'
import { useServeCitizenPanelsFlag } from '@shared/experiments/serveCitizenPanelsFlag'
import { Button } from '@styleguide'
import { ArchiveIcon } from '@styleguide/components/ui/icons'
import DashboardNavHeaderAction from '../../shared/DashboardNavHeaderAction'
import { chiefOfStaffArchiveHref } from '../routes'
import { managedCivicPanelQueryOptions } from '../../contacts/citizens-panel/civicPanelSummary.query'
import BriefingDispatchBanner from './BriefingDispatchBanner'
import { ONBOARDING_CARDS } from './onboardingCardsConfig'
import TaskStack from './TaskStack'
import FooterChatBar from './chat/FooterChatBar'
import ChiefOfStaffChatSurface from './chat/ChiefOfStaffChatSurface'
import {
  buildChiefOfStaffIntro,
  buildChiefOfStaffNextSteps,
} from './chat/chatConstants'
import { useBriefingDispatch } from '../data/use-briefing-dispatch'
import type { OnboardingCardKey } from '../data/contracts'

// The panel cards' turns, and the ones the invite review sends when it
// closes, hidden again when their conversation is reopened.
const HIDDEN_TURNS = [
  START_MANAGED_CIVIC_PANEL_MESSAGE,
  MANAGED_CIVIC_PANEL_EXHAUSTED_MESSAGE,
  MANAGED_CIVIC_PANEL_SET_UP_MESSAGE,
  MANAGED_CIVIC_PANEL_BACKED_OUT_MESSAGE,
]
// A kickoff answers in place of the intro, so the first-chat intro must not
// type in over it. Module-level so its identity is stable.
const NO_INTRO: string[] = []

/**
 * Chief of Staff dashboard (Serve home). Renders inside `DashboardLayout`.
 * Owns the chat-surface open state so both the footer bar and the onboarding
 * CTAs can open it — the CTAs additionally seed an agent opener, and a task
 * card's "Ask about this" seeds a hidden first message about that task.
 */
export default function DashboardContent(): React.JSX.Element {
  const [user] = useUser()
  const [chatOpen, setChatOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | undefined>(undefined)
  const [initialConversationId, setInitialConversationId] = useState<
    string | null
  >(null)
  const [openerKey, setOpenerKey] = useState<OnboardingCardKey | null>(null)
  // One-shot hidden first message: the build card's turn, or a task card's
  // "Ask about this".
  const [pendingKickoff, setPendingKickoff] = useState<string | undefined>(
    undefined,
  )
  // Owned here so the banner and the task list below it cannot disagree about
  // whether a briefing is generating.
  const { inFlight: briefingInFlight } = useBriefingDispatch()

  const firstName = user?.firstName || undefined

  const { ready: panelsReady, enabled: panelsEnabled } =
    useServeCitizenPanelsFlag(false)
  const orgSlug = useOrganization()?.slug
  // Whether GoodParty is already building the panel picks the intro's
  // middle step: set it up, or hear from constituents.
  const {
    data: managedPanel,
    isLoading: managedLoading,
    isError: managedReadFailed,
  } = useQuery({
    ...managedCivicPanelQueryOptions(orgSlug),
    enabled: panelsReady && panelsEnabled && Boolean(orgSlug),
  })
  // A failed read offers setup: approving is idempotent, so offering it to
  // an office already enrolled does no harm.
  const managedSetUp = managedReadFailed
    ? false
    : managedPanel === undefined
      ? undefined
      : managedPanel !== null && managedPanel.status !== 'stopped'

  const openNewChat = () => {
    setPendingFile(undefined)
    setOpenerKey(null)
    setPendingKickoff(undefined)
    setInitialConversationId(null)
    setChatOpen(true)
  }
  const openWithFile = (file: File) => {
    openNewChat()
    setPendingFile(file)
  }
  const openConversation = (id: string) => {
    setPendingFile(undefined)
    setOpenerKey(null)
    setPendingKickoff(undefined)
    setInitialConversationId(id)
    setChatOpen(true)
  }
  const openCard = (key: OnboardingCardKey) => {
    setPendingFile(undefined)
    setOpenerKey(key)
    setPendingKickoff(undefined)
    setInitialConversationId(null)
    setChatOpen(true)
  }
  const discussCard = (message: string) => {
    setPendingFile(undefined)
    setPendingKickoff(message)
    setOpenerKey(null)
    setInitialConversationId(null)
    setChatOpen(true)
  }

  // Memoized: the opener's identity keys the body's typing effect.
  const opener = useMemo(
    () =>
      openerKey ? ONBOARDING_CARDS[openerKey].opener(firstName) : undefined,
    [openerKey, firstName],
  )
  const intro = useMemo(() => buildChiefOfStaffIntro(firstName), [firstName])

  // The intro ends on a question, answered by these cards. The priorities
  // card asks its own question and a kickoff answers something already, so
  // neither gets them.
  const suggestions =
    pendingKickoff || openerKey === 'priorities'
      ? undefined
      : buildChiefOfStaffNextSteps({
          panelsEnabled: panelsReady && panelsEnabled,
          managedSetUp,
          panelLoading: !panelsReady || (panelsEnabled && managedLoading),
        })

  return (
    // Same shell as the Campaign Manager home: a 720px column, the stack
    // centered between the title bar (h-14) and the footer chat bar on
    // desktop, status banners under it. pb-24 clears the fixed footer bar,
    // which this page renders itself rather than through the CM dock.
    <div className="flex min-h-screen flex-col bg-muted pb-24 lg:min-h-[calc(100dvh-3.5rem)]">
      <DashboardNavHeaderAction>
        <Button asChild variant="outline" size="small">
          <Link href={chiefOfStaffArchiveHref()}>
            <ArchiveIcon className="size-4" aria-hidden />
            Archive
          </Link>
        </Button>
      </DashboardNavHeaderAction>
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 pt-6 lg:my-auto lg:py-6">
        {/*
         * Support-estimate hero hidden for now: the underlying number is only
         * available for ~half of offices, so showing it (or an empty state) is
         * misleading. The SupportHero component + useSupportEstimate hook are
         * intentionally left in place — re-render this once data coverage is
         * broad enough.
         */}
        <TaskStack
          onOpenCard={openCard}
          onDiscussCard={discussCard}
          briefingInFlight={briefingInFlight}
        />
        <BriefingDispatchBanner inFlight={briefingInFlight} />
      </div>

      <FooterChatBar
        firstName={firstName}
        onOpen={openNewChat}
        onOpenConversation={openConversation}
        onAttachFile={openWithFile}
      />
      <ChiefOfStaffChatSurface
        open={chatOpen}
        onOpenChange={(next) => {
          setChatOpen(next)
          // A later plain reopen (the footer bar) must never resend it.
          if (!next) {
            setPendingKickoff(undefined)
            setPendingFile(undefined)
          }
        }}
        initialConversationId={initialConversationId}
        opener={opener}
        openerKey={openerKey}
        pendingKickoff={pendingKickoff}
        pendingFile={pendingFile}
        defaultIntro={pendingKickoff ? NO_INTRO : intro}
        suggestions={suggestions}
        hiddenMessageContents={HIDDEN_TURNS}
        showMessageActions
        analyticsSurface="chief_of_staff_page"
      />
    </div>
  )
}

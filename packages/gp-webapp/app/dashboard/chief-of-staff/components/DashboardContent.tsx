'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  BUILD_CITIZENS_PANEL_MESSAGE,
  CIVIC_PANEL_BUILD_CHAT_PARAM,
  CIVIC_PANEL_BUILD_CHAT_VALUE,
  EXPLAIN_CIVIC_PANEL_MESSAGE,
} from '@goodparty_org/contracts'
import { useUser } from '@shared/hooks/useUser'
import { useServeCitizenPanelsFlag } from '@shared/experiments/serveCitizenPanelsFlag'
import { Button } from '@styleguide'
import { ArchiveIcon } from '@styleguide/components/ui/icons'
import DashboardNavHeaderAction from '../../shared/DashboardNavHeaderAction'
import { chiefOfStaffArchiveHref, chiefOfStaffHref } from '../routes'
import BriefingDispatchBanner from './BriefingDispatchBanner'
import { ONBOARDING_CARDS } from './onboardingCardsConfig'
import TaskStack from './TaskStack'
import FooterChatBar from './chat/FooterChatBar'
import ChiefOfStaffChatSurface from './chat/ChiefOfStaffChatSurface'
import { useBriefingDispatch } from '../data/use-briefing-dispatch'
import type { OnboardingCardKey } from '../data/contracts'

// The build card's turns, hidden again when their conversation is reopened.
const HIDDEN_TURNS = [BUILD_CITIZENS_PANEL_MESSAGE, EXPLAIN_CIVIC_PANEL_MESSAGE]
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

  // The build card's Build my panel links back here with the param, so the
  // official stays on the home: the chat opens on the conversation that
  // builds the panel, started by a turn they never see.
  const router = useRouter()
  const searchParams = useSearchParams()
  const buildPanelParam =
    searchParams?.get(CIVIC_PANEL_BUILD_CHAT_PARAM) ===
    CIVIC_PANEL_BUILD_CHAT_VALUE
  const { ready: panelsReady, enabled: panelsEnabled } =
    useServeCitizenPanelsFlag(false)
  useEffect(() => {
    if (!buildPanelParam || !panelsReady) return
    router.replace(chiefOfStaffHref(), { scroll: false })
    if (!panelsEnabled) return
    setOpenerKey(null)
    setInitialConversationId(null)
    setPendingKickoff(BUILD_CITIZENS_PANEL_MESSAGE)
    setChatOpen(true)
  }, [buildPanelParam, panelsReady, panelsEnabled, router])

  const openNewChat = () => {
    setOpenerKey(null)
    setPendingKickoff(undefined)
    setInitialConversationId(null)
    setChatOpen(true)
  }
  const openConversation = (id: string) => {
    setOpenerKey(null)
    setPendingKickoff(undefined)
    setInitialConversationId(id)
    setChatOpen(true)
  }
  const openCard = (key: OnboardingCardKey) => {
    setOpenerKey(key)
    setPendingKickoff(undefined)
    setInitialConversationId(null)
    setChatOpen(true)
  }
  const discussCard = (message: string) => {
    setPendingKickoff(message)
    setOpenerKey(null)
    setInitialConversationId(null)
    setChatOpen(true)
  }

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
        showAttachIcon
      />
      <ChiefOfStaffChatSurface
        open={chatOpen}
        onOpenChange={(next) => {
          setChatOpen(next)
          // A later plain reopen (the footer bar) must never resend it.
          if (!next) setPendingKickoff(undefined)
        }}
        initialConversationId={initialConversationId}
        opener={openerKey ? ONBOARDING_CARDS[openerKey].opener : undefined}
        openerKey={openerKey}
        pendingKickoff={pendingKickoff}
        defaultIntro={pendingKickoff ? NO_INTRO : undefined}
        hiddenMessageContents={HIDDEN_TURNS}
        showMessageActions
      />
    </div>
  )
}

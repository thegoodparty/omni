'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useUser } from '@shared/hooks/useUser'
import { Button } from '@styleguide'
import { ArchiveIcon } from '@styleguide/components/ui/icons'
import DashboardNavHeaderAction from '../../shared/DashboardNavHeaderAction'
import { chiefOfStaffArchiveHref } from '../routes'
import BriefingDispatchBanner from './BriefingDispatchBanner'
import { ONBOARDING_CARDS } from './onboardingCardsConfig'
import TaskStack from './TaskStack'
import FooterChatBar from './chat/FooterChatBar'
import ChiefOfStaffChatSurface from './chat/ChiefOfStaffChatSurface'
import { useBriefingDispatch } from '../data/use-briefing-dispatch'
import type { OnboardingCardKey } from '../data/contracts'

// A task-card kickoff answers in place of the intro, so the first-chat intro
// must not type in over it. Module-level so its identity is stable.
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
  // One-shot hidden first message from a task card's "Ask about this".
  const [kickoff, setKickoff] = useState<string | undefined>(undefined)
  // Owned here so the banner and the task list below it cannot disagree about
  // whether a briefing is generating.
  const { inFlight: briefingInFlight } = useBriefingDispatch()

  const firstName = user?.firstName || undefined

  const openNewChat = () => {
    setKickoff(undefined)
    setOpenerKey(null)
    setInitialConversationId(null)
    setChatOpen(true)
  }
  const openConversation = (id: string) => {
    setKickoff(undefined)
    setOpenerKey(null)
    setInitialConversationId(id)
    setChatOpen(true)
  }
  const openCard = (key: OnboardingCardKey) => {
    setKickoff(undefined)
    setOpenerKey(key)
    setInitialConversationId(null)
    setChatOpen(true)
  }
  const discussCard = (message: string) => {
    setKickoff(message)
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
          if (!next) setKickoff(undefined)
        }}
        initialConversationId={initialConversationId}
        opener={openerKey ? ONBOARDING_CARDS[openerKey].opener : undefined}
        openerKey={openerKey}
        pendingKickoff={kickoff}
        defaultIntro={kickoff ? NO_INTRO : undefined}
        showMessageActions
      />
    </div>
  )
}

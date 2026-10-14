'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  BUILD_CITIZENS_PANEL_MESSAGE,
  CIVIC_PANEL_BUILD_CHAT_PARAM,
  CIVIC_PANEL_BUILD_CHAT_VALUE,
} from '@goodparty_org/contracts'
import { useUser } from '@shared/hooks/useUser'
import { useServeCitizenPanelsFlag } from '@shared/experiments/serveCitizenPanelsFlag'
import { ArchiveIcon } from '@styleguide/components/ui/icons'
import { chiefOfStaffArchiveHref, chiefOfStaffHref } from '../routes'
import BriefingDispatchBanner from './BriefingDispatchBanner'
import { ONBOARDING_CARDS } from './onboardingCardsConfig'
import TaskStack from './TaskStack'
import FooterChatBar from './chat/FooterChatBar'
import ChiefOfStaffChatSurface from './chat/ChiefOfStaffChatSurface'
import { useBriefingDispatch } from '../data/use-briefing-dispatch'
import type { OnboardingCardKey } from '../data/contracts'

// The build card's turn, hidden again when its conversation is reopened.
const HIDDEN_TURNS = [BUILD_CITIZENS_PANEL_MESSAGE]

/**
 * Chief of Staff dashboard (Serve home). Renders inside `DashboardLayout`.
 * Owns the chat-surface open state so both the footer bar and the onboarding
 * CTAs can open it — the CTAs additionally seed an agent opener.
 */
export default function DashboardContent(): React.JSX.Element {
  const [user] = useUser()
  const [chatOpen, setChatOpen] = useState(false)
  const [initialConversationId, setInitialConversationId] = useState<
    string | null
  >(null)
  const [openerKey, setOpenerKey] = useState<OnboardingCardKey | null>(null)
  const [pendingKickoff, setPendingKickoff] = useState<string | undefined>(
    undefined,
  )
  // Owned here so the banner and the task list below it cannot disagree about
  // whether a briefing is generating.
  const { inFlight: briefingInFlight } = useBriefingDispatch()

  const firstName = user?.firstName || undefined

  // The build card's Get started links back here with the param, so the
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

  return (
    <div className="flex min-h-screen flex-col bg-muted pb-20 lg:pb-12">
      <div className="mx-auto flex w-full max-w-[608px] flex-col gap-6 p-4 pb-40 lg:p-6 lg:pb-40">
        {/*
         * Support-estimate hero hidden for now: the underlying number is only
         * available for ~half of offices, so showing it (or an empty state) is
         * misleading. The SupportHero component + useSupportEstimate hook are
         * intentionally left in place — re-render this once data coverage is
         * broad enough.
         */}
        <div className="flex flex-col gap-4">
          <Link
            href={chiefOfStaffArchiveHref()}
            className="inline-flex items-center gap-1.5 self-end text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
          >
            <ArchiveIcon className="size-4" aria-hidden />
            Archive
          </Link>
          <BriefingDispatchBanner inFlight={briefingInFlight} />
          <TaskStack
            onOpenCard={openCard}
            briefingInFlight={briefingInFlight}
          />
        </div>
      </div>

      <FooterChatBar
        firstName={firstName}
        onOpen={openNewChat}
        onOpenConversation={openConversation}
        showAttachIcon
      />
      <ChiefOfStaffChatSurface
        open={chatOpen}
        onOpenChange={setChatOpen}
        initialConversationId={initialConversationId}
        opener={openerKey ? ONBOARDING_CARDS[openerKey].opener : undefined}
        openerKey={openerKey}
        pendingKickoff={pendingKickoff}
        hiddenMessageContents={HIDDEN_TURNS}
        showMessageActions
      />
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import {
  CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL,
  CAMPAIGN_MANAGER_START_STORY_SENTINEL,
} from '@goodparty_org/contracts'
import { VoterContactsProvider } from '@shared/hooks/VoterContactsProvider'
import { CampaignUpdateHistoryProvider } from '@shared/hooks/CampaignUpdateHistoryProvider'
import { reportErrorToSentry } from '@shared/sentry'
import CampaignManagerTasks from './CampaignManagerTasks'
import ProUpgradeBanner from '../components/campaignManager/ProUpgradeBanner'
import ProgressSection from '../components/campaignManager/ProgressSection'
import FooterChatBar from '../chief-of-staff/components/chat/FooterChatBar'
import ChiefOfStaffChatSurface from '../chief-of-staff/components/chat/ChiefOfStaffChatSurface'
import type { ChatSuggestion } from '../chief-of-staff/components/chat/ChiefOfStaffChatBody'
import {
  CAMPAIGN_MANAGER_HISTORY_KEY,
  buildCampaignManagerIntro,
  campaignManagerChatApi,
} from './campaignManagerChat'

interface Props {
  firstName?: string
}

/**
 * The Campaign Manager dashboard home for the campaign-story cohort: the top
 * tracker tasks, a persistent chat bar, and a "meet your campaign manager"
 * entry that opens the shared chat surface bound to the campaign_assistant
 * scope. The shared surface/body/footer default to Chief of Staff; here they
 * are passed the Campaign Manager client, history key, and label.
 *
 * The manager runs as a single ongoing conversation: opening it resumes the
 * candidate's existing thread (or creates one on first open), so it always
 * continues where they left off. The server seeds the resume-aware greeting as
 * the conversation's first message; until the candidate replies, the chat body
 * types that seeded greeting in on open (no separate client opener).
 */
export default function CampaignManagerHome({
  firstName,
}: Props): React.JSX.Element {
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [chatOpen, setChatOpen] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  // One-shot hidden kickoff sent once the resolved conversation loads (see
  // ChiefOfStaffChatBody's pendingKickoff effect). Cleared on close so a later
  // plain reopen (e.g. the meet card) never replays it.
  const [pendingKickoff, setPendingKickoff] = useState<string | undefined>(
    undefined,
  )
  const composerRef = useRef<HTMLInputElement | null>(null)
  const personalizeDeepLinkFiredRef = useRef(false)

  // Entering via the story flow (the story card / personalize deep link) sets
  // pendingKickoff before the conversation opens. On that entry the kickoff
  // streams the story-intake greeting, so the server-seeded general greeting
  // ("Hi <name>, I'm your Campaign Manager.") would show ABOVE it — the double
  // greeting in the screenshot. Hide the exact seeded string on that entry only,
  // so it shows just the story flow (fresh open AND resume). The general "meet"/
  // footer entry (pendingKickoff undefined) keeps the greeting + starter chips.
  // The string mirrors gp-api's buildCampaignManagerGreeting (buildCampaign
  // ManagerIntro is its hand-synced client twin).
  const hiddenMessageContents = useMemo(() => {
    const base = [
      CAMPAIGN_MANAGER_START_STORY_SENTINEL,
      CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL,
    ]
    return pendingKickoff === CAMPAIGN_MANAGER_START_STORY_SENTINEL
      ? [...base, buildCampaignManagerIntro(firstName).join('\n\n')]
      : base
  }, [pendingKickoff, firstName])

  const suggestions: ChatSuggestion[] = [
    {
      label: 'Personalize your campaign',
      description:
        "Tell me about why you're running, and we'll help you draft your " +
        'voter outreach plan.',
      kickoff: CAMPAIGN_MANAGER_START_STORY_SENTINEL,
    },
    {
      label: 'Learn more about the product',
      description: 'Get a quick tour of the product and its features.',
      kickoff: CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL,
    },
    {
      label: 'Ask me about something else',
      description: 'Type any question in the box below.',
      onSelect: () => composerRef.current?.focus(),
    },
  ]

  // Resume-or-create the ongoing manager conversation, then open it by id so
  // the surface loads its transcript (starting with the seeded greeting).
  // Resolve before opening so the drawer opens straight into the conversation
  // rather than flashing an empty state.
  const openManager = useCallback(async () => {
    try {
      const { conversationId: id } =
        await campaignManagerChatApi.createConversation()
      setConversationId(id)
      // A conversation now exists, so refresh history so the footer picker
      // shows it. (The first-run "meet" card is dismissed only by clicking it,
      // not by a conversation existing, so it is unaffected here.)
      void queryClient.invalidateQueries({
        queryKey: CAMPAIGN_MANAGER_HISTORY_KEY,
      })
    } catch (err) {
      reportErrorToSentry(err, {
        surface: 'campaign-manager-chat',
        phase: 'init',
      })
      // Fall back to a fresh chat (deferred create on first send).
      setConversationId(null)
    }
    setChatOpen(true)
  }, [queryClient])

  const openConversation = useCallback((id: string) => {
    setConversationId(id)
    setChatOpen(true)
  }, [])

  // Opens the manager and queues the hidden story-intake sentinel so it fires
  // once the resolved conversation loads. Shared by the story card, the
  // personalize deep link, and (indirectly) both plan-tab gate links.
  const startStory = useCallback(() => {
    setPendingKickoff(CAMPAIGN_MANAGER_START_STORY_SENTINEL)
    void openManager()
  }, [openManager])

  // Deep link: the plan-tab story gate links to `/dashboard?personalize=1` so
  // "Open"/"Edit in campaign manager" starts the same story flow as the
  // manager home's own card. Ref-guarded so it only ever fires once per
  // mount; clears the param via replace so a refresh doesn't refire it.
  useEffect(() => {
    if (personalizeDeepLinkFiredRef.current) return
    if (searchParams?.get('personalize') !== '1') return
    // pathname is only null under the pages/ router compat typing; this
    // component only ever renders under the app router, where it's a string.
    if (!pathname) return
    personalizeDeepLinkFiredRef.current = true
    startStory()
    router.replace(pathname)
  }, [searchParams, router, pathname, startStory])

  return (
    <div className="flex min-h-screen flex-col bg-muted pb-20 lg:pb-12">
      <div className="pb-40">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 pt-6">
          <ProUpgradeBanner />
          <VoterContactsProvider>
            <CampaignUpdateHistoryProvider>
              <ProgressSection />
            </CampaignUpdateHistoryProvider>
          </VoterContactsProvider>
        </div>
        {/* onPersonalize opens the manager and auto-launches the story-intake
            chat flow (the hidden story sentinel), same as the deep link the
            plan-tab gate links use. */}
        <CampaignManagerTasks
          onMeetManager={() => void openManager()}
          onPersonalize={startStory}
        />
      </div>
      <FooterChatBar
        firstName={firstName}
        onOpen={() => void openManager()}
        onOpenConversation={openConversation}
        chatApi={campaignManagerChatApi}
        historyKey={CAMPAIGN_MANAGER_HISTORY_KEY}
        openLabel="Open campaign manager chat"
      />
      <ChiefOfStaffChatSurface
        open={chatOpen}
        onOpenChange={(next) => {
          setChatOpen(next)
          // Clear the one-shot kickoff on close: a later plain reopen (the
          // meet card, the footer bar) must never replay the story sentinel.
          if (!next) setPendingKickoff(undefined)
        }}
        initialConversationId={conversationId}
        title="Campaign manager"
        subtitle="Always on, focused on your week"
        chatApi={campaignManagerChatApi}
        analyticsLabel="campaign-manager-chat"
        historyKey={CAMPAIGN_MANAGER_HISTORY_KEY}
        defaultIntro={buildCampaignManagerIntro(firstName)}
        suggestions={suggestions}
        showSuggestionsWithGreeting
        pendingKickoff={pendingKickoff}
        composerRef={composerRef}
        hiddenMessageContents={hiddenMessageContents}
      />
    </div>
  )
}

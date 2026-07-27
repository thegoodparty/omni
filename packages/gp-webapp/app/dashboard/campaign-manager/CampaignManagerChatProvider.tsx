'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import {
  CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL,
  CAMPAIGN_MANAGER_START_STORY_SENTINEL,
} from '@goodparty_org/contracts'
import { useUser } from '@shared/hooks/useUser'
import { useCampaignStoryFlag } from '@shared/experiments/campaignStoryFlag'
import { useCampaignStoryComplete } from 'app/dashboard/campaign-story/useCampaignStoryComplete'
import { reportErrorToSentry } from '@shared/sentry'
import FooterChatBar from '../chief-of-staff/components/chat/FooterChatBar'
import ChiefOfStaffChatSurface from '../chief-of-staff/components/chat/ChiefOfStaffChatSurface'
import type { ChatSuggestion } from '../chief-of-staff/components/chat/ChiefOfStaffChatBody'
import {
  CAMPAIGN_MANAGER_HISTORY_KEY,
  buildCampaignManagerIntro,
  campaignManagerChatApi,
} from './campaignManagerChat'

// The first-run "meet your campaign manager" card (rendered on the manager home)
// is dismissed once the candidate opens the manager in its GENERAL mode (the
// meet card, the footer chat box, or a history conversation, which all land on
// the same manager greeting), persisted so it stays dismissed across reloads.
// It is deliberately NOT dismissed by the story flow (startStory): that opens
// the same conversation but into the story intake, which is not "meeting the
// manager".
const MEET_CARD_DISMISSED_KEY = 'campaign-manager-meet-dismissed'

interface CampaignManagerChatContextValue {
  // Open the manager in general mode (meet card / footer). Dismisses the
  // first-run meet card.
  openManager: () => void
  // Open a specific past conversation from history. Dismisses the meet card.
  openConversation: (id: string) => void
  // Open the manager into the story-intake flow. Does NOT dismiss the meet card.
  startStory: () => void
  // First-run meet-card visibility, shared so the home card and a manager open
  // stay in sync across the (layout-level) dock and the (page-level) card.
  meetDismissed: boolean
  dismissMeetCard: () => void
}

const CampaignManagerChatContext =
  createContext<CampaignManagerChatContextValue | null>(null)

// Returns the dock controls when rendered under a mounted dock (the story
// cohort), or null otherwise — callers outside the cohort (e.g. PlanView in
// onboarding) fall back to their own behavior.
export const useCampaignManagerChat =
  (): CampaignManagerChatContextValue | null =>
    useContext(CampaignManagerChatContext)

/**
 * The always-present Campaign Manager chat dock for the campaign-story cohort:
 * the persistent footer chat bar and the shared chat surface, bound to the
 * campaign_assistant scope. Mounted once per dashboard route (in
 * DashboardLayout, via DashboardCampaignManagerChat) so the manager is
 * reachable from every page. Exposes open/story controls through context so the
 * manager home's cards and the tracker's "Campaign Manager" button drive the
 * same dock instead of each owning a copy.
 *
 * The manager runs as a single ongoing conversation: opening it resumes the
 * candidate's existing thread (or creates one on first open), so it always
 * continues where they left off. The server seeds the resume-aware greeting as
 * the conversation's first message; until the candidate replies, the chat body
 * types that seeded greeting in on open (no separate client opener).
 */
export function CampaignManagerChatProvider({
  children,
}: {
  children: ReactNode
}): React.JSX.Element {
  const [user] = useUser()
  const firstName = user?.firstName || undefined
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
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
  // Once the story is complete (e.g. finished in onboarding), the candidate has
  // already personalized, so the "Personalize your campaign" starter chip is
  // dropped from the chat.
  const { isComplete: storyComplete } = useCampaignStoryComplete(true)

  // Default to showing the card (the common case: a new candidate who has not
  // dismissed it) so it renders immediately with no pop-in. The effect flips it
  // to dismissed only when the persisted key is present. A dismissed candidate
  // may see it for a single post-hydration frame (imperceptible), which is the
  // right trade: localStorage is unreadable during SSR, so a synchronous
  // initializer would either mismatch hydration or pop the card in for everyone.
  const [meetDismissed, setMeetDismissed] = useState(false)
  useEffect(() => {
    try {
      if (window.localStorage.getItem(MEET_CARD_DISMISSED_KEY) === '1') {
        setMeetDismissed(true)
      }
    } catch {
      // Storage disabled: leave meetDismissed false so the card shows.
    }
  }, [])
  const dismissMeetCard = useCallback(() => {
    try {
      window.localStorage.setItem(MEET_CARD_DISMISSED_KEY, '1')
    } catch {
      // Storage disabled (private mode): the card reappears next load, which is
      // acceptable for a first-run nudge.
    }
    setMeetDismissed(true)
  }, [])

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
    ...(storyComplete
      ? []
      : [
          {
            label: 'Personalize your campaign',
            description:
              "Tell me about why you're running, and we'll help you draft " +
              'your voter outreach plan.',
            kickoff: CAMPAIGN_MANAGER_START_STORY_SENTINEL,
          },
        ]),
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
  // rather than flashing an empty state. Does NOT touch the meet card — the
  // callers below decide whether opening counts as "meeting the manager".
  // Guarded against concurrent opens (a double-click, or a general open racing
  // the story flow): createConversation always creates a NEW conversation, so
  // two in-flight calls would orphan one. Matches OnboardingFlow's isAdvancingRef.
  const resumingRef = useRef(false)
  const resumeAndOpen = useCallback(async () => {
    if (resumingRef.current) return
    resumingRef.current = true
    try {
      const { conversationId: id } =
        await campaignManagerChatApi.createConversation()
      setConversationId(id)
      // A conversation now exists, so refresh history so the footer picker
      // shows it.
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
    } finally {
      resumingRef.current = false
    }
    setChatOpen(true)
  }, [queryClient])

  // General open (meet card / footer): counts as meeting the manager, so it
  // dismisses the first-run meet card.
  const openManager = useCallback(() => {
    dismissMeetCard()
    void resumeAndOpen()
  }, [dismissMeetCard, resumeAndOpen])

  const openConversation = useCallback(
    (id: string) => {
      dismissMeetCard()
      setConversationId(id)
      setChatOpen(true)
    },
    [dismissMeetCard],
  )

  // Opens the manager and queues the hidden story-intake sentinel so it fires
  // once the resolved conversation loads. Shared by the story card, the
  // personalize deep link, and both plan-tab gate links. Does NOT dismiss the
  // meet card (the story flow is not "meeting the manager").
  const startStory = useCallback(() => {
    // Bail if an open is already in flight (matching resumeAndOpen's guard):
    // otherwise we'd set the story kickoff but resumeAndOpen would no-op, and
    // the sentinel would later fire into the racing general-mode open.
    if (resumingRef.current) return
    setPendingKickoff(CAMPAIGN_MANAGER_START_STORY_SENTINEL)
    void resumeAndOpen()
  }, [resumeAndOpen])

  // The personalize deep link (`/dashboard?personalize=1`) is how the plan-tab
  // story gate's "Open"/"Edit in campaign manager" links start the same story
  // flow as the manager home's own card. Read from the URL directly (not
  // useSearchParams) so this layout-level mount never forces a Suspense
  // boundary on unrelated pages. Ref-guarded so it fires once per mount; clears
  // the param via replace so a refresh doesn't refire it.
  useEffect(() => {
    if (personalizeDeepLinkFiredRef.current) return
    if (!pathname) return
    let hasParam = false
    try {
      hasParam =
        new URLSearchParams(window.location.search).get('personalize') === '1'
    } catch {
      hasParam = false
    }
    if (!hasParam) return
    personalizeDeepLinkFiredRef.current = true
    startStory()
    router.replace(pathname)
  }, [pathname, router, startStory])

  const contextValue = useMemo(
    () => ({
      openManager,
      openConversation,
      startStory,
      meetDismissed,
      dismissMeetCard,
    }),
    [openManager, openConversation, startStory, meetDismissed, dismissMeetCard],
  )

  return (
    <CampaignManagerChatContext.Provider value={contextValue}>
      {children}
      {/* Reserve space at the end of the scroll flow so the fixed footer bar
          (~80px tall) never overlaps the bottom of page content — e.g. Your
          Story's "Start over" / "Add a policy priority". shrink-0 keeps it from
          collapsing when the content region is a flex child. */}
      <div aria-hidden className="h-24 shrink-0" />
      <FooterChatBar
        firstName={firstName}
        onOpen={openManager}
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
        quickPrompts={[
          'What should I focus on to win?',
          'Which voters should I reach this week?',
        ]}
        composerPlaceholder={
          firstName ? `Hi ${firstName}, how can I help?` : 'How can I help?'
        }
        pendingKickoff={pendingKickoff}
        composerRef={composerRef}
        hiddenMessageContents={hiddenMessageContents}
      />
    </CampaignManagerChatContext.Provider>
  )
}

// Mounts the dock for the campaign-story cohort only; every other cohort gets
// the children untouched (no footer chat, no context — zero behavior change).
// trackExposure=false: the dock is not the treatment surface (the manager home
// / story pages are), so reading the flag here must not inflate the exposed
// population.
export function DashboardCampaignManagerChat({
  children,
}: {
  children: ReactNode
}): React.JSX.Element {
  const { enabled } = useCampaignStoryFlag(false)
  if (!enabled) return <>{children}</>
  return <CampaignManagerChatProvider>{children}</CampaignManagerChatProvider>
}

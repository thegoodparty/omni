'use client'

import { useMemo, useRef, useState } from 'react'
import {
  CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL,
  CAMPAIGN_MANAGER_START_STORY_SENTINEL,
} from '@goodparty_org/contracts'
import type { TcrCompliance } from 'helpers/types'
import { useUser } from '@shared/hooks/useUser'
import ConversationalHome, {
  type ConversationalHomeConfig,
} from '../chief-of-staff/components/chat/ConversationalHome'
import type { ChatSuggestion } from '../chief-of-staff/components/chat/ChiefOfStaffChatBody'
import {
  CAMPAIGN_MANAGER_HISTORY_KEY,
  buildCampaignManagerIntro,
  campaignManagerChatApi,
} from './campaignManagerChat'
import CampaignManagerHero from './CampaignManagerHero'
import CampaignManagerTaskCards, {
  useCampaignManagerTaskCards,
} from './CampaignManagerTaskCards'

// Chips and task cards must never share a turn, so the home hands the body an
// empty list whenever the card rail is rendering. A stable identity keeps the
// body's suggestion memo from re-running every render.
const NO_SUGGESTIONS: ChatSuggestion[] = []

/**
 * Win's binding of the conversational home: the Campaign Manager scope's chat
 * config, the returning-candidate hero, and the week's task-card rail.
 *
 * Rendered instead of `CampaignManagerHome` (the card stack) when
 * `campaign-manager-chat-home` is on. The footer chat dock is dropped on this
 * route in that case, so this owns the kickoff state the dock's provider owns
 * elsewhere — the same one-shot hidden sends, minus the drawer.
 *
 * Unlike the drawer, the seeded greeting stays visible here even when a card
 * fires the story kickoff: the candidate has already read the greeting on the
 * page, so hiding it (which is what the dock does to avoid a double greeting on
 * a story-flow entry) would make it disappear under them.
 */
export default function CampaignManagerChatHome({
  tcrCompliance,
}: {
  // Threaded from the server render, same as the card home, so the texting
  // setup prompt can read the TCR record without a second fetch.
  tcrCompliance: TcrCompliance | null
}): React.JSX.Element {
  const [user] = useUser()
  const firstName = user?.firstName || undefined
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const [pendingKickoff, setPendingKickoff] = useState<string | undefined>(
    undefined,
  )

  const { cards, isGenerating, isWeekClear, showCompliance } =
    useCampaignManagerTaskCards({ onKickoff: setPendingKickoff })

  const config = useMemo<ConversationalHomeConfig>(
    () => ({
      chatApi: campaignManagerChatApi,
      analyticsLabel: 'campaign-manager-chat-home',
      historyKey: CAMPAIGN_MANAGER_HISTORY_KEY,
      defaultIntro: buildCampaignManagerIntro(firstName),
      composerPlaceholder: firstName
        ? `Hi ${firstName}, how can I help?`
        : 'How can I help?',
      // Overridden because the agent's name reads as a proper noun in prose.
      disclaimer:
        'Campaign Manager can make mistakes. Check important details.',
      // Only the two canned-reply sentinels. The ballot kickoff is a real LLM
      // turn, and hiding it would drop the filing answer from the transcript on
      // reload (see campaignManagerChat.ts).
      hiddenMessageContents: [
        CAMPAIGN_MANAGER_START_STORY_SENTINEL,
        CAMPAIGN_MANAGER_PRODUCT_OVERVIEW_SENTINEL,
      ],
      // Shown only when the card rail is empty, so the candidate always has
      // somewhere to start.
      suggestions: [
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
      ],
    }),
    [firstName],
  )

  return (
    <ConversationalHome
      config={config}
      pendingKickoff={pendingKickoff}
      composerRef={composerRef}
      leadingSlot={<CampaignManagerHero />}
      trailingSlot={
        <CampaignManagerTaskCards
          cards={cards}
          isGenerating={isGenerating}
          isWeekClear={isWeekClear}
          showCompliance={showCompliance}
          tcrCompliance={tcrCompliance}
        />
      }
      suggestions={
        cards.length > 0 || showCompliance ? NO_SUGGESTIONS : undefined
      }
    />
  )
}

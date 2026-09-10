'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useUser } from '@shared/hooks/useUser'
import ConversationalHome, {
  type ConversationalHomeConfig,
} from './chat/ConversationalHome'
import type { ChatSuggestion } from './chat/ChiefOfStaffChatBody'
import { COS_INTRO_MESSAGES } from './chat/chatConstants'
import { chiefOfStaffChatApi } from '../data/chat-api'
import { HISTORY_KEY } from '../data/use-chat-history'
import { ONBOARDING_CARDS } from './onboardingCardsConfig'
import ChiefOfStaffHero from './ChiefOfStaffHero'
import ChiefOfStaffTaskCards, {
  useChiefOfStaffTaskCards,
} from './ChiefOfStaffTaskCards'
import type { OnboardingCardKey } from '../data/contracts'

// Chips and task cards must never share a turn, so the home hands the body an
// empty list whenever the card rail is rendering. A stable identity keeps the
// body's suggestion memo from re-running every render.
const NO_SUGGESTIONS: ChatSuggestion[] = []

/**
 * Serve's binding of the conversational home: the Chief of Staff scope's chat
 * config, the returning-official hero, and the week's task-card rail.
 *
 * Rendered instead of the card stack when `chief-of-staff-chat-home` is on.
 * Nothing here touches a prompt: the agent's scope, system prompt and tools are
 * exactly what the drawer already used, and the get-started openers are the
 * same display-only copy the card home passes to the drawer.
 */
export default function ChiefOfStaffChatHome(): React.JSX.Element {
  const [user] = useUser()
  const firstName = user?.firstName || undefined
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const [openerKey, setOpenerKey] = useState<OnboardingCardKey | null>(null)

  const onOpenCard = useCallback(
    (key: OnboardingCardKey) => setOpenerKey(key),
    [],
  )
  const { cards, isPending, isError, isAllCaughtUp } = useChiefOfStaffTaskCards(
    { onOpenCard },
  )

  const config = useMemo<ConversationalHomeConfig>(
    () => ({
      chatApi: chiefOfStaffChatApi,
      analyticsLabel: 'chief-of-staff-chat-home',
      historyKey: HISTORY_KEY,
      defaultIntro: COS_INTRO_MESSAGES,
      composerPlaceholder: firstName
        ? `Hi ${firstName}, how can I help?`
        : 'How can I help?',
      disclaimer: 'Chief of Staff can make mistakes. Check important details.',
    }),
    [firstName],
  )

  return (
    <ConversationalHome
      config={config}
      composerRef={composerRef}
      opener={openerKey ? ONBOARDING_CARDS[openerKey].opener : undefined}
      openerKey={openerKey}
      leadingSlot={<ChiefOfStaffHero />}
      trailingSlot={
        <ChiefOfStaffTaskCards
          cards={cards}
          isPending={isPending}
          isError={isError}
          isAllCaughtUp={isAllCaughtUp}
        />
      }
      // Suppressed while the rail has cards; the body's own Chief of Staff
      // starter prompts take over when it does not.
      suggestions={cards.length > 0 ? NO_SUGGESTIONS : undefined}
    />
  )
}

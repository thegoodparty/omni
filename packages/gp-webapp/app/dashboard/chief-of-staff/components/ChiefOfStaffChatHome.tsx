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
import PriorityChoiceStep from './PriorityChoiceStep'
import ChiefOfStaffTaskCards, {
  useChiefOfStaffTaskCards,
} from './ChiefOfStaffTaskCards'
import { usePriorities } from '../data/use-priorities'
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
  const { cards, isPending, isError } = useChiefOfStaffTaskCards({
    onOpenCard,
  })

  // Which onboarding step the official is on is derived from their priorities,
  // not stored — the same approach the onboarding-cards service takes
  // server-side. No priorities means we have no idea what they are working on,
  // so asking that is the only thing worth putting on screen.
  const { data: priorities, isPending: prioritiesPending } = usePriorities()
  const needsFirstPriority = !prioritiesPending && priorities?.length === 0

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
        needsFirstPriority ? (
          // Nothing competes with the first question, including the
          // get-started cards — the `priorities` one is this step, in card
          // form.
          <PriorityChoiceStep firstName={firstName} />
        ) : (
          <ChiefOfStaffTaskCards
            cards={cards}
            isPending={isPending}
            isError={isError}
          />
        )
      }
      // Suppressed while the rail has cards or is asking the first question;
      // the body's own Chief of Staff starter prompts take over when it is
      // neither.
      suggestions={
        needsFirstPriority || cards.length > 0 ? NO_SUGGESTIONS : undefined
      }
    />
  )
}

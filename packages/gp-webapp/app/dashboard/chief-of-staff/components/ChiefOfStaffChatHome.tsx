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
import PriorityStageStep from './PriorityStageStep'
import PriorityNextStep from './PriorityNextStep'
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
  // server-side. No priorities means we have no idea what they are working on;
  // a priority with no stage means we know the problem but not how far along
  // they are. `stage` is null for every row that predates the question and for
  // anything the agent or a Win import created, so this reads as "not asked".
  const { data: priorities, isPending: prioritiesPending } = usePriorities()
  const needsFirstPriority = !prioritiesPending && priorities?.length === 0
  // The newest un-staged one: the list comes back createdAt ascending, so the
  // priority they just picked is the last match.
  //
  // Strictly `=== null`, not falsy, on purpose. An API that predates the
  // `stage` column returns the field absent rather than null, and treating
  // that as unanswered would ask the question against a deployment that cannot
  // store the answer — so the step stays hidden until the column is really
  // there.
  const needsStage = prioritiesPending
    ? undefined
    : priorities?.filter((p) => p.stage === null).at(-1)
  // The newest priority we DO know the stage of. Its next step is a standing
  // recommendation, not a step that completes: nothing links a priority to the
  // outreach done about it, so there is no "already did this" to derive.
  //
  // `!= null` so an absent field counts as unknown, not as staged. The strict
  // check above and this loose one are the two halves of the same rule: an API
  // without the column asks nothing and recommends nothing, rather than
  // suppressing the starter chips for a turn that renders empty.
  const staged = priorities?.filter((p) => p.stage != null).at(-1)

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
        ) : needsStage ? (
          <PriorityStageStep priority={needsStage} />
        ) : (
          <div className="flex flex-col gap-5">
            {staged?.stage != null && (
              <PriorityNextStep priority={{ ...staged, stage: staged.stage }} />
            )}
            <ChiefOfStaffTaskCards
              cards={cards}
              isPending={isPending}
              isError={isError}
            />
          </div>
        )
      }
      // Suppressed while the rail has cards or is asking a question; the
      // body's own Chief of Staff starter prompts take over when it is neither.
      suggestions={
        needsFirstPriority || needsStage || staged || cards.length > 0
          ? NO_SUGGESTIONS
          : undefined
      }
    />
  )
}

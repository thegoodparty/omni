'use client'

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { reportErrorToSentry } from '@shared/sentry'
import ChiefOfStaffChatBody, {
  type ChatSuggestion,
} from './ChiefOfStaffChatBody'
import type { AgentChatClient } from '../../../shared/agent-chat/chatClient'

/**
 * Everything that binds the conversational home to one agent scope. Win passes
 * the Campaign Manager's config; Serve can pass Chief of Staff's with no fork,
 * which is why the home takes a config object rather than reading either
 * scope's module-level client directly.
 */
export interface ConversationalHomeConfig {
  chatApi: AgentChatClient
  analyticsLabel: string
  historyKey: readonly unknown[]
  /** Played only if resolving the ongoing conversation fails. */
  defaultIntro: string[]
  suggestions?: ChatSuggestion[]
  quickPrompts?: string[]
  composerPlaceholder?: string
  disclaimer?: string
  /** Sentinels to drop from a reloaded transcript. */
  hiddenMessageContents?: string[]
}

interface Props {
  config: ConversationalHomeConfig
  /** One-shot hidden kickoff, e.g. fired by a task-card CTA. */
  pendingKickoff?: string
  composerRef?: RefObject<HTMLTextAreaElement | null>
  /** Hero greeting, rendered above the transcript. */
  leadingSlot?: ReactNode
  /** Task-card rail rendered at the end of the transcript. */
  trailingSlot?: ReactNode
  /**
   * Starter chips for this turn. Pass an empty array to suppress them — chips
   * and task cards must never share a turn, so a caller rendering a card rail
   * empties this.
   */
  suggestions?: ChatSuggestion[]
}

/**
 * The conversation-first dashboard home: the shared chat body promoted out of
 * the bottom drawer and rendered inline, full height, as the page itself.
 *
 * The one thing this owns that the drawer surface does not is the bootstrap.
 * The drawer can open empty and defer creating a conversation until the first
 * send; a home cannot — it has to open onto the agent's own greeting. So it
 * resolves the ongoing conversation before mounting the body (the
 * `campaign_assistant` scope's `createConversation` resumes the candidate's
 * latest thread, seeding the greeting only when none exists) and passes the id
 * as `conversationIdOverride`, which is what makes the body type the seeded
 * greeting in rather than dump it.
 *
 * A failed resolve falls through to the body's own deferred create, so the home
 * still takes a message instead of dead-ending on an error.
 */
export default function ConversationalHome({
  config,
  pendingKickoff,
  composerRef,
  leadingSlot,
  trailingSlot,
  suggestions,
}: Props): React.JSX.Element {
  const queryClient = useQueryClient()
  const [resolving, setResolving] = useState(true)
  const [conversationId, setConversationId] = useState<string | null>(null)
  // Guards the effect against a double-invoke (React strict mode, a fast
  // remount): each createConversation call is a round trip, and on a scope
  // without resume it would mint a second thread.
  const resolvedRef = useRef(false)

  const { chatApi, historyKey } = config
  useEffect(() => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    void (async () => {
      try {
        const { conversationId: id } = await chatApi.createConversation()
        setConversationId(id)
        // A conversation now exists, so the history popover's list is stale.
        void queryClient.invalidateQueries({ queryKey: historyKey })
      } catch (err) {
        reportErrorToSentry(err, {
          surface: 'conversational-home',
          phase: 'init',
        })
        setConversationId(null)
      } finally {
        setResolving(false)
      }
    })()
  }, [chatApi, historyKey, queryClient])

  if (resolving) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading chat...</p>
      </div>
    )
  }

  return (
    // No background of its own: the home sits directly on the shell's #f5f5f5
    // canvas, and only the bubbles, cards and composer carry a surface.
    <div className="flex min-h-0 flex-1 flex-col">
      <ChiefOfStaffChatBody
        // Remount on a history switch so the body reloads that transcript.
        key={conversationId ?? 'new'}
        conversationIdOverride={conversationId ?? undefined}
        onSelectConversation={setConversationId}
        chatApi={config.chatApi}
        analyticsLabel={config.analyticsLabel}
        historyKey={config.historyKey}
        defaultIntro={config.defaultIntro}
        suggestions={suggestions ?? config.suggestions}
        showSuggestionsWithGreeting
        quickPrompts={config.quickPrompts}
        composerPlaceholder={config.composerPlaceholder}
        disclaimer={config.disclaimer}
        hiddenMessageContents={config.hiddenMessageContents}
        pendingKickoff={pendingKickoff}
        composerRef={composerRef}
        leadingSlot={leadingSlot}
        trailingSlot={trailingSlot}
        // The 608px measure the whole surface shares: transcript, cards, hero
        // and composer all sit on it, so nothing reads ragged. Gutters step
        // 12/16/24px at sm/md/above.
        bodyClassName="mx-auto flex min-h-0 w-full max-w-[608px] flex-1 flex-col gap-3 overflow-y-auto px-3 py-6 sm:px-4 md:px-6"
      />
    </div>
  )
}

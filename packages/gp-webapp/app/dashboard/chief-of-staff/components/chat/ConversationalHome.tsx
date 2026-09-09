'use client'

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { useOrganization } from '@shared/organization-picker'
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
  /** Played on the candidate's first ever chat. */
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

// Where the active conversation is remembered. sessionStorage, not local: the
// home opens a fresh conversation each session, and past ones are reached
// through the composer's history popover.
const sessionKey = (label: string, orgSlug: string | null): string =>
  `conversational-home:${label}:${orgSlug ?? 'none'}`

const readSessionConversation = (key: string): string | null => {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    // Storage disabled: the sitting fragments into a conversation per mount,
    // which is survivable. Never throw on the render path for this.
    return null
  }
}

/**
 * The conversation-first dashboard home: the shared chat body promoted out of
 * the bottom drawer and rendered inline, full height, as the page itself.
 *
 * Each session starts a new conversation rather than resuming the last one. A
 * resumed thread would mean a candidate three months in loads months of scroll
 * on every visit, with the week's cards pinned somewhere below it — and an
 * opening "here is what changed" turn would land under all of it. So the home
 * opens empty and the first message mints the conversation (the body's own
 * deferred create); earlier conversations are reached through the history
 * popover in the composer.
 *
 * "Session" is the browser session, not the mount: the active id is held in
 * sessionStorage so navigating to the tracker and back continues the same
 * conversation instead of splitting one sitting in two. It is keyed by org, so
 * switching orgs lands on that org's own conversation.
 *
 * A consequence worth knowing: this surface never sees the server-seeded,
 * resume-aware greeting, because that is written at conversation creation and
 * nothing is created until the candidate sends. The hero carries the greeting
 * instead.
 */
export default function ConversationalHome({
  config,
  pendingKickoff,
  composerRef,
  leadingSlot,
  trailingSlot,
  suggestions,
}: Props): React.JSX.Element {
  const organization = useOrganization()
  const orgSlug = organization?.slug ?? null
  const storageKey = sessionKey(config.analyticsLabel, orgSlug)

  // Null until read: sessionStorage is unreadable during SSR, so a synchronous
  // initializer would either mismatch hydration or mount the body against the
  // wrong conversation and fire its load.
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)

  useEffect(() => {
    setConversationId(readSessionConversation(storageKey))
    setRestored(true)
  }, [storageKey])

  // Remember the conversation the first send created, so the rest of this
  // session continues it.
  const onConversationCreated = useCallback(
    (id: string) => {
      try {
        window.sessionStorage.setItem(storageKey, id)
      } catch {
        // Storage disabled: see readSessionConversation.
      }
    },
    [storageKey],
  )

  // Picking a past conversation from the history popover switches to it for the
  // rest of the session, the same as one started here.
  const onSelectConversation = useCallback(
    (id: string) => {
      onConversationCreated(id)
      setConversationId(id)
    },
    [onConversationCreated],
  )

  if (!restored) {
    return <div className="flex min-h-0 flex-1" />
  }

  return (
    // No background of its own: the home sits directly on the shell's #f5f5f5
    // canvas, and only the bubbles, cards and composer carry a surface.
    <div className="flex min-h-0 flex-1 flex-col">
      <ChiefOfStaffChatBody
        // Remount on a conversation switch (a history pick, or an org change)
        // so the body loads that transcript against a clean deferred-create
        // state.
        key={`${storageKey}:${conversationId ?? 'new'}`}
        conversationIdOverride={conversationId ?? undefined}
        onConversationCreated={onConversationCreated}
        onSelectConversation={onSelectConversation}
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
        bodyClassName="mx-auto flex min-h-0 w-full max-w-[608px] flex-1 flex-col gap-5 overflow-y-auto px-3 py-6 sm:px-4 md:px-6"
      />
    </div>
  )
}

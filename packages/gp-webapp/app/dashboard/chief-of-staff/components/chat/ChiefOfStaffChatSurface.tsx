'use client'

import { useEffect, useState, type RefObject } from 'react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@styleguide'
import { SparklesIcon } from '@styleguide/components/ui/icons'
import ChiefOfStaffChatBody, {
  type ChatSuggestion,
} from './ChiefOfStaffChatBody'
import type { AgentChatClient } from '../../../shared/agent-chat/chatClient'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, open directly into this conversation (from history). */
  initialConversationId?: string | null
  /** Display-only assistant opener to play (e.g. from an onboarding card). */
  opener?: string[]
  /** Identity of the opener — changes remount the body for a fresh chat. */
  openerKey?: string | null
  /** Header title/subtitle. Default to Chief of Staff. */
  title?: string
  subtitle?: string
  /** Scope config threaded to the body. All default to Chief of Staff. */
  chatApi?: AgentChatClient
  analyticsLabel?: string
  historyKey?: readonly unknown[]
  defaultIntro?: string[]
  /** Starter chips threaded to the body. Default to Chief of Staff's. */
  suggestions?: ChatSuggestion[]
  /** Show the chips alongside a seeded greeting, not only on empty. */
  showSuggestionsWithGreeting?: boolean
  /** Quick-prompt pills threaded to the body (below the suggestions). */
  quickPrompts?: string[]
  /** Composer placeholder threaded to the body. */
  composerPlaceholder?: string
  /** One-shot kickoff message sent hidden on open. */
  pendingKickoff?: string
  /** Ref to the body's composer input, so a suggestion can focus it. */
  composerRef?: RefObject<HTMLTextAreaElement | null>
  /**
   * Fine-print line under the composer. Defaults to "<title> can make
   * mistakes. Check important details.", so every surface carries one and a new
   * mount gets it for free. Override only when the agent's display name differs
   * from `title` (e.g. the manager's title is sentence-cased).
   */
  disclaimer?: string
  /** Message contents to hide from a reloaded transcript (e.g. sentinels). */
  hiddenMessageContents?: string[]
}

/**
 * The Chief of Staff chat surface — a bottom drawer hosting the reusable chat
 * body. History lives in the input pill's clock popover (see
 * ChatHistoryPopover); picking a conversation there swaps the active one here.
 */
export default function ChiefOfStaffChatSurface({
  open,
  onOpenChange,
  initialConversationId,
  opener,
  openerKey,
  title = 'Chief of Staff',
  subtitle = 'Always on, working on your week',
  chatApi,
  analyticsLabel,
  historyKey,
  defaultIntro,
  suggestions,
  showSuggestionsWithGreeting,
  quickPrompts,
  composerPlaceholder,
  pendingKickoff,
  composerRef,
  disclaimer = `${title} can make mistakes. Check important details.`,
  hiddenMessageContents,
}: Props): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(
    initialConversationId ?? null,
  )

  // Sync the active conversation when the surface opens or the caller targets
  // a specific conversation (e.g. picked from the footer's history popover).
  useEffect(() => {
    if (open) setSelectedId(initialConversationId ?? null)
  }, [open, initialConversationId])

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="flex h-[90vh] flex-col p-0"
        aria-describedby={undefined}
      >
        <DrawerHeader className="flex flex-row items-center gap-2 border-b border-border p-4 pr-12">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <SparklesIcon className="size-4" aria-hidden />
          </span>
          <div className="flex flex-col text-left">
            <DrawerTitle>{title}</DrawerTitle>
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          </div>
        </DrawerHeader>

        <ChiefOfStaffChatBody
          // Remount on conversation switch (or onboarding-card switch) so the
          // body picks up the right conversation / a clean deferred-create
          // state with the right opener.
          key={selectedId ?? openerKey ?? 'new'}
          active={open}
          conversationIdOverride={selectedId ?? undefined}
          opener={opener}
          onSelectConversation={setSelectedId}
          chatApi={chatApi}
          analyticsLabel={analyticsLabel}
          historyKey={historyKey}
          defaultIntro={defaultIntro}
          suggestions={suggestions}
          showSuggestionsWithGreeting={showSuggestionsWithGreeting}
          quickPrompts={quickPrompts}
          composerPlaceholder={composerPlaceholder}
          pendingKickoff={pendingKickoff}
          composerRef={composerRef}
          disclaimer={disclaimer}
          hiddenMessageContents={hiddenMessageContents}
          bodyClassName="mx-auto flex min-h-0 w-full max-w-[608px] flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
        />
      </DrawerContent>
    </Drawer>
  )
}

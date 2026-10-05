'use client'

import { useEffect, useState, type RefObject } from 'react'
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  GoodPartyOrgLogo,
} from '@styleguide'
import ChiefOfStaffChatBody, {
  type ChatSuggestion,
} from './ChiefOfStaffChatBody'
import type {
  AgentChatClient,
  ChatScope,
} from '../../../shared/agent-chat/chatClient'

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
  /**
   * One-shot VISIBLE opening message, for an entry point that collected the
   * user's first request before this surface opened (the contacts assistant
   * bar). Don't pass it together with `pendingKickoff`.
   */
  pendingMessage?: string
  /** Fires once per visible message the user sends. */
  onMessageSent?: () => void
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
  /** Show the per-message copy + thumbs bar under each assistant turn. */
  showMessageActions?: boolean
  /**
   * The chat scope forwarded to the body's useAttachmentsEnabled call.
   * Defaults to 'chief_of_staff'; Campaign Manager passes 'campaign_assistant'.
   */
  scope?: ChatScope
  /**
   * Renders a "New chat" action in the header. Called so the owner can clear
   * its own conversation/kickoff state; the surface itself drops the active
   * conversation and remounts the body on a fresh chat.
   */
  onNewChat?: () => void
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
  pendingMessage,
  onMessageSent,
  composerRef,
  disclaimer = `${title} can make mistakes. Check important details.`,
  hiddenMessageContents,
  showMessageActions,
  scope,
  onNewChat,
}: Props): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(
    initialConversationId ?? null,
  )
  // Bumped by "New chat" and folded into the body's key: clearing selectedId
  // alone can't remount a body that deferred-created its conversation this
  // session (selectedId was already null, so the key would not change).
  const [newChatNonce, setNewChatNonce] = useState(0)

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
        {/* DrawerHeader stacks its children in a column, so the row lives in
            one child. Its close button sits beside this row; the row is 32px
            tall so the close's -mt-1 centers on it. */}
        <DrawerHeader className="border-b border-border px-4 py-3">
          <div className="flex h-8 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-background">
              <GoodPartyOrgLogo className="h-3.5 w-4" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col text-left">
              <DrawerTitle className="truncate text-base leading-5">
                {title}
              </DrawerTitle>
              <span className="truncate text-xs text-muted-foreground">
                {subtitle}
              </span>
            </div>
            {onNewChat && (
              <Button
                type="button"
                variant="outline"
                size="small"
                className="shrink-0"
                onClick={() => {
                  setSelectedId(null)
                  setNewChatNonce((n) => n + 1)
                  onNewChat()
                }}
              >
                New chat
              </Button>
            )}
          </div>
        </DrawerHeader>

        <ChiefOfStaffChatBody
          // Remount on conversation switch (or onboarding-card switch) so the
          // body picks up the right conversation / a clean deferred-create
          // state with the right opener. `pendingKickoff` is part of the
          // identity too: a caller can swap one kickoff for another on an
          // ALREADY-OPEN surface (the manager's story and ballot home cards),
          // and without it the key stays 'new', the body keeps the
          // conversation the first kickoff created, and the second kickoff is
          // appended to that thread instead of starting its own.
          key={`${selectedId ?? openerKey ?? pendingKickoff ?? 'new'}:${newChatNonce}`}
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
          // Only while the surface is still on the fresh chat this was
          // opened for. Picking a past conversation from the composer's
          // history popover sets selectedId, which remounts the body — and a
          // remount resets its sent-latch, so an un-gated prop would deliver
          // the caller's original request a second time, into a thread the
          // viewer merely navigated to.
          pendingMessage={selectedId ? undefined : pendingMessage}
          onMessageSent={onMessageSent}
          composerRef={composerRef}
          disclaimer={disclaimer}
          hiddenMessageContents={hiddenMessageContents}
          showMessageActions={showMessageActions}
          scope={scope}
          bodyClassName="mx-auto flex min-h-0 w-full max-w-[608px] flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
        />
      </DrawerContent>
    </Drawer>
  )
}

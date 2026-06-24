'use client'

import { useEffect, useState } from 'react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@styleguide'
import { SparklesIcon } from '@styleguide/components/ui/icons'
import ChiefOfStaffChatBody from './ChiefOfStaffChatBody'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, open directly into this conversation (from history). */
  initialConversationId?: string | null
  /** Display-only assistant opener to play (e.g. from an onboarding card). */
  opener?: string[]
  /** Identity of the opener — changes remount the body for a fresh chat. */
  openerKey?: string | null
  /** Start dictation as soon as the chat opens (footer mic entry). */
  autoDictate?: boolean
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
  autoDictate,
}: Props): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(
    initialConversationId ?? null,
  )
  // Mirrors the autoDictate prop on open, but clears on an in-drawer
  // conversation switch so dictation never re-fires inside a historical chat.
  const [shouldAutoDictate, setShouldAutoDictate] = useState(
    autoDictate ?? false,
  )

  // Sync the active conversation when the surface opens or the caller targets
  // a specific conversation (e.g. picked from the footer's history popover).
  useEffect(() => {
    if (open) {
      setSelectedId(initialConversationId ?? null)
      setShouldAutoDictate(autoDictate ?? false)
    }
  }, [open, initialConversationId, autoDictate])

  const handleSelectConversation = (id: string) => {
    setShouldAutoDictate(false)
    setSelectedId(id)
  }

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
            <DrawerTitle>Chief of Staff</DrawerTitle>
            <span className="text-xs text-muted-foreground">
              Always on, working on your week
            </span>
          </div>
        </DrawerHeader>

        <ChiefOfStaffChatBody
          // Remount on conversation switch (or onboarding-card switch) so the
          // body picks up the right conversation / a clean deferred-create
          // state with the right opener.
          key={selectedId ?? openerKey ?? 'new'}
          active={open}
          autoDictate={shouldAutoDictate}
          conversationIdOverride={selectedId ?? undefined}
          opener={opener}
          onSelectConversation={handleSelectConversation}
          bodyClassName="mx-auto flex min-h-0 w-full max-w-[608px] flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
        />
      </DrawerContent>
    </Drawer>
  )
}

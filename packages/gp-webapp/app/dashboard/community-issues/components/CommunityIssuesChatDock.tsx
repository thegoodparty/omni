'use client'

import { useRef, useState, type RefObject } from 'react'
import { Button } from '@styleguide'
import { SparklesIcon } from '@styleguide/components/ui/icons'
import { useUser } from '@shared/hooks/useUser'
import { useTextSelection } from '@shared/text-selection/useTextSelection'
import { APP_BASE } from 'appEnv'
import type { ChatAnchor } from '@goodparty_org/contracts'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import FooterChatBar from '../../chief-of-staff/components/chat/FooterChatBar'
import ChiefOfStaffChatSurface from '../../chief-of-staff/components/chat/ChiefOfStaffChatSurface'
import { chiefOfStaffChatApi } from '../../chief-of-staff/data/chat-api'

type AnchorIssue = { id: string; title: string; summary: string }

// The Chief of Staff footer bar + chat surface for the Community Issues pages.
// When given an anchorIssue + a selectionContainerRef (the detail page), it also
// renders the highlight -> "Ask AI" popover, opening the chat anchored to the
// selected text.
const CommunityIssuesChatDock = ({
  anchorIssue,
  selectionContainerRef,
}: {
  anchorIssue?: AnchorIssue
  selectionContainerRef?: RefObject<HTMLElement | null>
}): React.JSX.Element => {
  const [user] = useUser()
  const fallbackRef = useRef<HTMLElement | null>(null)
  const selection = useTextSelection(selectionContainerRef ?? fallbackRef)

  const [chatOpen, setChatOpen] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [opener, setOpener] = useState<string[] | undefined>(undefined)
  const [openerKey, setOpenerKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const openNewChat = () => {
    setConversationId(null)
    setOpener(undefined)
    setOpenerKey(null)
    setChatOpen(true)
  }

  const openConversation = (id: string) => {
    setConversationId(id)
    setOpener(undefined)
    setOpenerKey(id)
    setChatOpen(true)
  }

  const openAnchored = async () => {
    if (!anchorIssue || creating) return
    const highlightedText = selection?.text
    trackEvent(EVENTS.CommunityIssues.AskAIStarted, { issueId: anchorIssue.id })

    const anchor: ChatAnchor = {
      resourceType: 'community_issue',
      resourceId: anchorIssue.id,
      url: `${APP_BASE}/dashboard/community-issues/${anchorIssue.id}`,
      snapshot: {
        title: anchorIssue.title,
        summary: anchorIssue.summary,
        ...(highlightedText ? { highlightedText } : {}),
      },
    }
    window.getSelection()?.removeAllRanges()
    setError(null)
    setCreating(true)
    try {
      const { conversationId: newId } =
        await chiefOfStaffChatApi.createConversation(anchor)
      setConversationId(newId)
      setOpener([
        highlightedText
          ? `About "${anchorIssue.title}". You highlighted: "${highlightedText}"`
          : `About "${anchorIssue.title}".`,
      ])
      setOpenerKey(newId)
      setChatOpen(true)
    } catch {
      setError('Could not start the chat. Please try again.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      {anchorIssue && selection ? (
        <div
          className="fixed z-50 -translate-x-1/2"
          style={{
            top: selection.rect.top - 44,
            left: selection.rect.left + selection.rect.width / 2,
          }}
        >
          <Button
            size="small"
            disabled={creating}
            onMouseDown={(e) => e.preventDefault()}
            onClick={openAnchored}
            className="flex items-center gap-1.5 shadow-md"
          >
            <SparklesIcon className="size-4" aria-hidden />
            Ask AI
          </Button>
        </div>
      ) : null}
      {error ? (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground shadow-md">
          {error}
        </div>
      ) : null}
      <FooterChatBar
        firstName={user?.firstName ?? undefined}
        onOpen={openNewChat}
        onOpenConversation={openConversation}
      />
      <ChiefOfStaffChatSurface
        open={chatOpen}
        onOpenChange={setChatOpen}
        initialConversationId={conversationId}
        opener={opener}
        openerKey={openerKey}
      />
    </>
  )
}

export default CommunityIssuesChatDock

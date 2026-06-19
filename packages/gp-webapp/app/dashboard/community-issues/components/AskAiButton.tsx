'use client'

import { useState } from 'react'
import { Button } from '@styleguide'
import { SparklesIcon } from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { APP_BASE } from 'appEnv'
import type { ChatAnchor } from '@goodparty_org/contracts'
import { chiefOfStaffChatApi } from '../../chief-of-staff/data/chat-api'
import ChiefOfStaffChatSurface from '../../chief-of-staff/components/chat/ChiefOfStaffChatSurface'

interface Props {
  issue: { id: string; title: string; summary: string }
}

const AskAiButton = ({ issue }: Props): React.JSX.Element => {
  const [loading, setLoading] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)

  const handleClick = async () => {
    trackEvent(EVENTS.CommunityIssues.AskAIStarted, { issueId: issue.id })
    const highlightedText = window.getSelection()?.toString().trim()

    const anchor: ChatAnchor = {
      resourceType: 'community_issue_feed',
      resourceId: issue.id,
      url: `${APP_BASE}/dashboard/community-issues/${issue.id}`,
      snapshot: {
        title: issue.title,
        summary: issue.summary,
        ...(highlightedText ? { highlightedText } : {}),
      },
    }

    setLoading(true)
    try {
      const { conversationId: newId } =
        await chiefOfStaffChatApi.createConversation(anchor)
      setConversationId(newId)
      setChatOpen(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={handleClick}
        disabled={loading}
        className="flex items-center gap-1.5"
      >
        <SparklesIcon className="size-4" aria-hidden />
        Ask AI
      </Button>
      <ChiefOfStaffChatSurface
        open={chatOpen}
        onOpenChange={setChatOpen}
        initialConversationId={conversationId}
      />
    </>
  )
}

export default AskAiButton

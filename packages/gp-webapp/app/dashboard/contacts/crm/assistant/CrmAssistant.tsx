'use client'

import { useState } from 'react'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useContactsTable } from '../ContactsTableProvider'
import { getContactsLabels } from '../../../shared/contactsLabels'
import { ASSISTANT_PLACEHOLDER, getAssistantChat } from './assistantChat'
import AssistantBar from './AssistantBar'
import AssistantDrawer, { type AssistantRequest } from './AssistantDrawer'

// The contacts-page assistant: the persistent bottom bar plus the right-side
// conversation drawer. Mounted inside CrmContactsPage, so the CRM flag gate
// (ContactsPageGate) already keeps flag-off pages byte-identical.
export default function CrmAssistant(): React.JSX.Element | null {
  const { isWinContext, isWinContextReady } = useContactsTable()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [request, setRequest] = useState<AssistantRequest | null>(null)
  const [requestKey, setRequestKey] = useState(0)

  // The chat scope (and its history popover fetch) must not fire on the
  // unsettled mode — isWinContext reads false (the Serve default) until then,
  // which would bind a Win user to the chief_of_staff scope.
  if (!isWinContextReady) return null

  const chat = getAssistantChat(isWinContext)
  const labels = getContactsLabels(isWinContext)
  const context = isWinContext ? 'win' : 'serve'

  // ENG-10767: chat opened + message sent (the instrument-analytics-event
  // skill's AI-chat exception to the UI-chrome skip list), so open-to-send
  // drop-off is visible. A bar submit opens the drawer WITH a first message,
  // so it fires both; a history pick fires only Opened; composer follow-ups
  // fire MessageSent via onMessageSent. isWinContextReady is guaranteed by
  // the early return above.
  const openWith = (
    next: AssistantRequest,
    source: 'message' | 'history',
  ): void => {
    trackEvent(EVENTS.Contacts.AssistantChatOpened, { context, source })
    setRequest(next)
    setRequestKey((k) => k + 1)
    setDrawerOpen(true)
  }

  const trackMessageSent = (): void => {
    trackEvent(EVENTS.Contacts.AssistantMessageSent, { context })
  }

  return (
    <>
      <AssistantBar
        chat={chat}
        onSubmit={(message) => {
          trackMessageSent()
          openWith({ kind: 'new', initialMessage: message }, 'message')
        }}
        onOpenConversation={(conversationId) =>
          openWith({ kind: 'existing', conversationId }, 'history')
        }
      />
      <AssistantDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        request={request}
        requestKey={requestKey}
        chat={chat}
        title={labels.assistantTitle}
        subtitle={ASSISTANT_PLACEHOLDER}
        onMessageSent={trackMessageSent}
      />
    </>
  )
}

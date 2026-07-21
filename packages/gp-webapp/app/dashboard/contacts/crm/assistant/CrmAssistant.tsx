'use client'

import { useState } from 'react'
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

  const openWith = (next: AssistantRequest): void => {
    setRequest(next)
    setRequestKey((k) => k + 1)
    setDrawerOpen(true)
  }

  return (
    <>
      <AssistantBar
        chat={chat}
        onSubmit={(message) =>
          openWith({ kind: 'new', initialMessage: message })
        }
        onOpenConversation={(conversationId) =>
          openWith({ kind: 'existing', conversationId })
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
      />
    </>
  )
}

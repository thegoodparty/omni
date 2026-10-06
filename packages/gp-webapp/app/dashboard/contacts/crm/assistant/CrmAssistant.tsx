'use client'

import { useRef, useState } from 'react'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useContactsTable } from '../ContactsTableProvider'
import { ASSISTANT_PLACEHOLDER, getAssistantChat } from './assistantChat'
import AssistantBar from './AssistantBar'
import ChiefOfStaffChatSurface from '../../../chief-of-staff/components/chat/ChiefOfStaffChatSurface'

// The contacts-page assistant: the persistent bottom bar plus the agent's own
// chat surface. There is no list-building agent of its own — the bar has
// always ridden the Chief of Staff / Campaign Manager scopes (see
// assistantChat.ts), whose prompt already carries the contact-list, saved-list
// and list-map rules. So this mounts the real surface those scopes use rather
// than a second one that looked like a different assistant and quietly lacked
// its widgets (a `show_list_map` call rendered as a bare status pill, so the
// agent would say it had drawn a map that was never there).
//
// Mounted inside CrmContactsPage, so the CRM flag gate (ContactsPageGate)
// already keeps flag-off pages byte-identical.
export default function CrmAssistant(): React.JSX.Element | null {
  const { isWinContext, isWinContextReady } = useContactsTable()
  const [open, setOpen] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  // The bar collects the first message before the surface is open, so it goes
  // in as a prop and the surface opens onto the answer.
  const [pendingMessage, setPendingMessage] = useState<string | undefined>(
    undefined,
  )
  // A per-submit identity, folded into the surface's body key. Without it a
  // second bar submit keeps the body the first one mounted — `selectedId` was
  // already null, so the key would not change — and the new request is
  // appended to the conversation that body deferred-created rather than
  // starting its own. A counter rather than the message text, so submitting
  // the same words twice still opens a fresh chat instead of being swallowed
  // by the body's sent-once latch. (The old drawer's `requestKey`.)
  const [openerKey, setOpenerKey] = useState<string | null>(null)
  const submitCountRef = useRef(0)

  // The chat scope (and its history popover fetch) must not fire on the
  // unsettled mode — isWinContext reads false (the Serve default) until then,
  // which would bind a Win user to the chief_of_staff scope.
  if (!isWinContextReady) return null

  const chat = getAssistantChat(isWinContext)
  const context = isWinContext ? 'win' : 'serve'

  // ENG-10767: chat opened + message sent (the instrument-analytics-event
  // skill's AI-chat exception to the UI-chrome skip list), so open-to-send
  // drop-off is visible. Only Opened is fired here; every message — the bar's
  // first one and each composer follow-up — is counted once by the surface's
  // onMessageSent, which fires on its own visible send path. Firing Sent here
  // too would double-count the first.
  const openWithMessage = (message: string): void => {
    trackEvent(EVENTS.Contacts.AssistantChatOpened, {
      context,
      source: 'message',
    })
    submitCountRef.current += 1
    setConversationId(null)
    setPendingMessage(message)
    setOpenerKey(`bar-submit-${submitCountRef.current}`)
    setOpen(true)
  }

  const openConversation = (id: string): void => {
    trackEvent(EVENTS.Contacts.AssistantChatOpened, {
      context,
      source: 'history',
    })
    setConversationId(id)
    setPendingMessage(undefined)
    setOpenerKey(id)
    setOpen(true)
  }

  return (
    <>
      <AssistantBar
        chat={chat}
        onSubmit={openWithMessage}
        onOpenConversation={openConversation}
      />
      <ChiefOfStaffChatSurface
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          // Drop the pending message on close so reopening from the bar's
          // clock popover doesn't re-send the last request.
          if (!next) setPendingMessage(undefined)
        }}
        initialConversationId={conversationId}
        openerKey={openerKey}
        pendingMessage={pendingMessage}
        title={chat.agentName}
        subtitle={ASSISTANT_PLACEHOLDER}
        chatApi={chat.chatApi}
        analyticsLabel={chat.analyticsLabel}
        historyKey={chat.historyKey}
        scope={chat.scope}
        defaultIntro={chat.defaultIntro}
        onMessageSent={() =>
          trackEvent(EVENTS.Contacts.AssistantMessageSent, { context })
        }
      />
    </>
  )
}

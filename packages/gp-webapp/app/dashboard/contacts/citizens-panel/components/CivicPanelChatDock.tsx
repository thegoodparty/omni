import { useRef, useState } from 'react'
import { useUser } from '@shared/hooks/useUser'
import FooterChatBar from '../../../chief-of-staff/components/chat/FooterChatBar'
import ChiefOfStaffChatSurface from '../../../chief-of-staff/components/chat/ChiefOfStaffChatSurface'

interface ChatState {
  open: boolean
  conversationId: string | null
  openerKey: string | null
  pendingMessage?: string
  pendingFile?: File
}

const CLOSED: ChatState = { open: false, conversationId: null, openerKey: null }

// The Chief of Staff chat for the panel page: the same footer bar the other
// Serve pages pin to the bottom, and a way for the page to open it on a
// question of its own.
export const useCivicPanelChat = () => {
  const [state, setState] = useState<ChatState>(CLOSED)
  // A fresh key per opening, so asking the same question twice still starts
  // its own chat instead of landing in the last one.
  const opens = useRef(0)
  const fresh = (extra: Partial<ChatState> = {}): void => {
    opens.current += 1
    setState({
      open: true,
      conversationId: null,
      openerKey: `civic-panel-${opens.current}`,
      ...extra,
    })
  }
  return {
    state,
    setState,
    openNew: () => fresh(),
    openWithFile: (file: File) => fresh({ pendingFile: file }),
    openConversation: (id: string) =>
      setState({ open: true, conversationId: id, openerKey: id }),
    ask: (message: string) => fresh({ pendingMessage: message }),
  }
}

export type CivicPanelChat = ReturnType<typeof useCivicPanelChat>

export const CivicPanelChatDock = ({ chat }: { chat: CivicPanelChat }) => {
  const [user] = useUser()
  const { state, setState } = chat
  return (
    <>
      <FooterChatBar
        firstName={user?.firstName ?? undefined}
        onOpen={chat.openNew}
        onOpenConversation={chat.openConversation}
        onAttachFile={chat.openWithFile}
      />
      <ChiefOfStaffChatSurface
        open={state.open}
        onOpenChange={(next) =>
          setState((prev) =>
            next
              ? { ...prev, open: true }
              : {
                  ...prev,
                  open: false,
                  pendingMessage: undefined,
                  pendingFile: undefined,
                },
          )
        }
        initialConversationId={state.conversationId}
        openerKey={state.openerKey}
        pendingMessage={state.pendingMessage}
        pendingFile={state.pendingFile}
        analyticsSurface="civic_panel_dock"
      />
    </>
  )
}

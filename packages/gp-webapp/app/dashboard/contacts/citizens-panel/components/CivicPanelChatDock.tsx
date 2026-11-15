import { useRef, useState } from 'react'
import { useUser } from '@shared/hooks/useUser'
import FooterChatBar from '../../../chief-of-staff/components/chat/FooterChatBar'
import ChiefOfStaffChatSurface from '../../../chief-of-staff/components/chat/ChiefOfStaffChatSurface'
import {
  SERVE_CITIZENS_PANEL_COPY,
  type CivicPanelStage,
} from '../citizensPanelCopy'

interface ChatState {
  open: boolean
  conversationId: string | null
  openerKey: string | null
  pendingFile?: File
}

const CLOSED: ChatState = { open: false, conversationId: null, openerKey: null }

// The Chief of Staff chat for the civic panel page: the same footer bar the
// other Serve pages pin to the bottom, with the page's own question in it.
export const useCivicPanelChat = () => {
  const [state, setState] = useState<ChatState>(CLOSED)
  // A fresh key per opening, so each new chat starts its own conversation
  // instead of landing in the last one.
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
  }
}

export type CivicPanelChat = ReturnType<typeof useCivicPanelChat>

export const CivicPanelChatDock = ({
  chat,
  stage,
}: {
  chat: CivicPanelChat
  stage: CivicPanelStage
}) => {
  const [user] = useUser()
  const { state, setState } = chat
  return (
    <>
      <FooterChatBar
        firstName={user?.firstName ?? undefined}
        onOpen={chat.openNew}
        onOpenConversation={chat.openConversation}
        onAttachFile={chat.openWithFile}
        placeholder={
          stage === 'ready'
            ? SERVE_CITIZENS_PANEL_COPY.chatPlaceholderFull
            : stage === 'exhausted'
              ? SERVE_CITIZENS_PANEL_COPY.chatPlaceholderExhausted
              : SERVE_CITIZENS_PANEL_COPY.chatPlaceholder
        }
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
                  pendingFile: undefined,
                },
          )
        }
        initialConversationId={state.conversationId}
        openerKey={state.openerKey}
        pendingFile={state.pendingFile}
        analyticsSurface="civic_panel_dock"
      />
    </>
  )
}

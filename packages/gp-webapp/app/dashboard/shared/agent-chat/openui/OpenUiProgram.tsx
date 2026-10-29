import {
  BuiltinActionType,
  Renderer,
  type LibraryActionEvent,
  type OpenUIError,
} from '@openuidev/react-lang'
import { OPEN_UI_COPY, openUiLibrary } from './openUiLibrary'

export type OpenUiActionEvent = LibraryActionEvent<typeof openUiLibrary>

// Every action a generated UI can fire ends as one of two things: a user turn
// sent through the surface's own send path, or a link opened. The renderer
// itself never talks to the model.
export const OpenUiProgram = ({
  program,
  onMessage,
  onAction,
  onError,
}: {
  program: string
  onMessage: (content: string) => void
  onAction?: (event: OpenUiActionEvent) => void
  onError?: (errors: OpenUIError[]) => void
}) => (
  <Renderer
    response={program}
    library={openUiLibrary}
    onError={onError}
    onAction={(event) => {
      onAction?.(event)
      if (event.type === 'StartOutreach') {
        onMessage(OPEN_UI_COPY.startOutreach(event.params.channel))
      } else if (
        event.type === BuiltinActionType.ContinueConversation &&
        event.humanFriendlyMessage
      ) {
        onMessage(event.humanFriendlyMessage)
      } else if (
        event.type === BuiltinActionType.OpenUrl &&
        typeof event.params.url === 'string'
      ) {
        window.open(event.params.url, '_blank', 'noopener,noreferrer')
      }
    }}
  />
)

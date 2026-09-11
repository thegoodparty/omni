import type { ComponentType, ReactNode } from 'react'
import { Badge } from '@styleguide'
import {
  ASSISTANT_BUBBLE,
  AssistantMarkdown,
  AssistantRow,
  InlineSegments,
  ThinkingRow,
  UserBubble,
} from '../../../shared/agent-chat/chatUI'
import type { LiveSegment } from '../../../shared/agent-chat/streaming'

// The turn chrome a chat body renders with.
//
// This indirection exists for one reason: the conversation-first Chief of Staff
// home needs a different visual language for every turn element, and the pieces
// it would otherwise restyle live in `shared/agent-chat/chatUI.tsx` — which
// Win's campaign manager, the ordinance flow, the briefing Ask-AI panel and the
// CRM assistant all render through. Editing them there would redesign four
// other products by accident.
//
// So a body takes its chrome as data. `DEFAULT_CHAT_CHROME` is the shared
// look; a surface that wants something else passes its own. Omitting it leaves
// every existing consumer byte-identical, which is the property that matters.

export interface ChatChrome {
  AssistantRow: ComponentType<{ children: ReactNode }>
  AssistantMarkdown: ComponentType<{ children: string }>
  UserBubble: ComponentType<{ children: ReactNode }>
  ThinkingRow: ComponentType<{ label?: string }>
  InlineSegments: ComponentType<{
    segments: LiveSegment[]
    toolLabel: (toolName: string) => string | null
  }>
  /** Class string for a plain, non-markdown assistant bubble. */
  assistantBubble: string
  /** One quick-reply / suggestion pill. */
  QuickReply: ComponentType<{
    children: ReactNode
    disabled?: boolean
    onClick: () => void
  }>
  /** The bar that holds the quick-reply row and the composer. */
  composerBarClassName: string
  /**
   * The wrapping row the quick-reply pills sit in. Owns its own left padding
   * because the spec indents the pills to align under the bubble, not under
   * the avatar, and that indent depends on the chrome's avatar size.
   */
  quickReplyRowClassName: string
}

const DEFAULT_QUICK_REPLY_ROW =
  'mx-auto flex w-full max-w-[608px] flex-wrap gap-2 px-3 pb-1 pt-2'

const DefaultQuickReply = ({
  children,
  disabled = false,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element => (
  <Badge
    asChild
    variant="soft"
    shape="pill"
    className="h-auto border-border bg-grayscale-50 px-3 py-1.5 disabled:pointer-events-none disabled:opacity-50"
  >
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  </Badge>
)

export const DEFAULT_CHAT_CHROME: ChatChrome = {
  AssistantRow,
  AssistantMarkdown,
  UserBubble,
  ThinkingRow,
  InlineSegments,
  assistantBubble: ASSISTANT_BUBBLE,
  QuickReply: DefaultQuickReply,
  composerBarClassName: 'border-t border-border px-3 py-3',
  quickReplyRowClassName: DEFAULT_QUICK_REPLY_ROW,
}

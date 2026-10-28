import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import type { ChatScope } from './chatClient'

export type ChatSurface =
  | 'chief_of_staff_page'
  | 'campaign_manager_page'
  | 'contacts_assistant'
  | 'community_issues_dock'
  | 'ordinances_dock'
  | 'civic_panel_dock'
  | 'priority_workspace'
  | 'ordinance_draft'

export type ChatSendVia = 'composer' | 'clarify' | 'assistant_bar'

// One event for every message a user sends to an agent, so chat engagement is
// one series cut by agent and surface. Only what the user typed or picked:
// hidden kickoffs, markers and Get answers turns never call this.
export const trackChatMessageSent = ({
  agent,
  surface,
  via,
  priorityId,
  ordinanceId,
}: {
  agent: ChatScope
  surface: ChatSurface
  via: ChatSendVia
  priorityId?: string
  ordinanceId?: string | number
}): void => {
  trackEvent(EVENTS.AIChat.MessageSent, {
    agent,
    surface,
    via,
    product: agent === 'campaign_assistant' ? 'win' : 'serve',
    ...(priorityId ? { priorityId } : {}),
    ...(ordinanceId !== undefined ? { ordinanceId } : {}),
  })
}

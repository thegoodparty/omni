import type { ChatScope } from './chatClient'

// The chat scopes that support attaching documents and links. Mirrors
// gp-api's ATTACHMENT_SCOPES, which 404s the write routes for any other scope.
export const supportsAttachments = (scope: ChatScope): boolean =>
  scope === 'chief_of_staff' || scope === 'campaign_assistant'

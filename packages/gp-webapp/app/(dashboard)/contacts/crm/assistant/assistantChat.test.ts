import { describe, expect, it } from 'vitest'
import { getAssistantChat } from './assistantChat'
import { campaignManagerChatApi } from '../../../campaign-manager/campaignManagerChat'
import { CAMPAIGN_MANAGER_HISTORY_KEY } from '../../../campaign-manager/campaignManagerChat'
import { chiefOfStaffChatApi } from '../../../chief-of-staff/data/chat-api'
import { HISTORY_KEY } from '../../../chief-of-staff/data/use-chat-history'
import { toolDisplayName } from '../../../chief-of-staff/components/chat/chatConstants'

describe('getAssistantChat', () => {
  it('binds Win to the campaign_assistant client and its history key', () => {
    const binding = getAssistantChat(true)
    expect(binding.chatApi).toBe(campaignManagerChatApi)
    expect(binding.historyKey).toBe(CAMPAIGN_MANAGER_HISTORY_KEY)
    expect(binding.scope).toBe('campaign_assistant')
    expect(binding.agentName).toBe('Chat')
  })

  it('binds Serve to the chief_of_staff client and its history key', () => {
    const binding = getAssistantChat(false)
    expect(binding.chatApi).toBe(chiefOfStaffChatApi)
    expect(binding.historyKey).toBe(HISTORY_KEY)
    expect(binding.scope).toBe('chief_of_staff')
    expect(binding.agentName).toBe('Chief of Staff')
  })
})

// The contacts surface no longer carries its own tool-label map — it renders
// through the shared chat body, so the list tools' status lines have to be in
// the shared table or a list-building turn shows raw tool names.
describe('the shared tool labels cover the list tools', () => {
  it('labels the CRM list tools', () => {
    expect(toolDisplayName('describe_filter_dimensions')).toBe(
      'Checking available filters',
    )
    expect(toolDisplayName('count_contacts')).toBe('Counting matches')
    expect(toolDisplayName('crud_saved_filters')).toBe('Working on your lists')
    expect(toolDisplayName('list_precincts')).toBe('Looking up precincts')
  })

  it('still covers the other scope tools', () => {
    expect(toolDisplayName('web_search')).toBe('Searching the web')
  })
})

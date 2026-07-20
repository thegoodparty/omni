import { describe, expect, it } from 'vitest'
import { assistantToolLabel, getAssistantChat } from './assistantChat'
import { campaignManagerChatApi } from '../../../campaign-manager/campaignManagerChat'
import { CAMPAIGN_MANAGER_HISTORY_KEY } from '../../../campaign-manager/campaignManagerChat'
import { chiefOfStaffChatApi } from '../../../chief-of-staff/data/chat-api'
import { HISTORY_KEY } from '../../../chief-of-staff/data/use-chat-history'

describe('getAssistantChat', () => {
  it('binds Win to the campaign_assistant client and its history key', () => {
    const binding = getAssistantChat(true)
    expect(binding.chatApi).toBe(campaignManagerChatApi)
    expect(binding.historyKey).toBe(CAMPAIGN_MANAGER_HISTORY_KEY)
  })

  it('binds Serve to the chief_of_staff client and its history key', () => {
    const binding = getAssistantChat(false)
    expect(binding.chatApi).toBe(chiefOfStaffChatApi)
    expect(binding.historyKey).toBe(HISTORY_KEY)
  })
})

describe('assistantToolLabel', () => {
  it('labels the CRM list tools', () => {
    expect(assistantToolLabel('describe_filter_dimensions')).toBe(
      'Checking available filters',
    )
    expect(assistantToolLabel('count_contacts')).toBe('Counting matches')
    expect(assistantToolLabel('crud_saved_filters')).toBe(
      'Working on your lists',
    )
  })

  it('falls back to the shared display names for scope tools', () => {
    expect(assistantToolLabel('web_search')).toBe('Searching the web')
  })
})

import { describe, expect, it } from 'vitest'
import { supportsAttachments } from './attachmentScopes'

describe('supportsAttachments', () => {
  it('is true for the chief of staff and the campaign manager', () => {
    expect(supportsAttachments('chief_of_staff')).toBe(true)
    expect(supportsAttachments('campaign_assistant')).toBe(true)
  })

  it('is false for every other scope', () => {
    expect(supportsAttachments('ordinance_flow')).toBe(false)
    expect(supportsAttachments('priority_flow')).toBe(false)
  })
})

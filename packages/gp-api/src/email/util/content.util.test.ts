import { describe, expect, it } from 'vitest'
import { getTeamMemberAddedEmailContent } from './content.util'

describe('getTeamMemberAddedEmailContent', () => {
  it('renders the invitee name, campaign name, role label, and CTA link', () => {
    const html = getTeamMemberAddedEmailContent(
      'Jamie',
      'Jamie for Mayor',
      'https://app.goodparty.org/dashboard',
    )

    expect(html).toContain('Jamie')
    expect(html).toContain('Jamie for Mayor')
    expect(html).toContain('Campaign Manager')
    expect(html).not.toContain('Admin')
    expect(html).toContain('https://app.goodparty.org/dashboard')
  })
})

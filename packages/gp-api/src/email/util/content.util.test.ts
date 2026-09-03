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

  it('escapes HTML in the invitee name and campaign name', () => {
    const html = getTeamMemberAddedEmailContent(
      '<script>alert(1)</script>',
      '<b>Fake Login</b>',
      'https://app.goodparty.org/dashboard',
    )

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>Fake Login</b>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;b&gt;Fake Login&lt;/b&gt;')
  })
})

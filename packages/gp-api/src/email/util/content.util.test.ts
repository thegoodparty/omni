import { describe, expect, it } from 'vitest'
import {
  getBasicEmailContent,
  getTeamMemberAddedEmailContent,
} from './content.util'

describe('getTeamMemberAddedEmailContent', () => {
  it('renders the invitee name, campaign name, role label, and CTA link', () => {
    const html = getTeamMemberAddedEmailContent(
      'Jamie',
      'Jamie for Mayor',
      'https://app.goodparty.org/dashboard',
      'campaignAdmin',
    )

    expect(html).toContain('Jamie')
    expect(html).toContain('Jamie for Mayor')
    expect(html).toContain('as Campaign Manager.')
    expect(html).not.toContain('Admin.')
    expect(html).toContain('https://app.goodparty.org/dashboard')
  })

  it('renders the Volunteer label for a volunteer direct-add', () => {
    const html = getTeamMemberAddedEmailContent(
      'Jamie',
      'Jamie for Mayor',
      'https://app.goodparty.org/dashboard',
      'volunteer',
    )

    expect(html).toContain('as Volunteer.')
    expect(html).not.toContain('Campaign Manager')
  })

  it('escapes HTML in the invitee name and campaign name', () => {
    const html = getTeamMemberAddedEmailContent(
      '<script>alert(1)</script>',
      '<b>Fake Login</b>',
      'https://app.goodparty.org/dashboard',
      'campaignAdmin',
    )

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>Fake Login</b>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;b&gt;Fake Login&lt;/b&gt;')
  })

  it('escapes the link so it cannot break out of the href attribute', () => {
    const html = getTeamMemberAddedEmailContent(
      'Jamie',
      'Jamie for Mayor',
      'https://app.goodparty.org/dashboard"onmouseover="alert(1)',
      'campaignAdmin',
    )

    expect(html).not.toContain('"onmouseover="alert(1)')
    expect(html).toContain('&quot;onmouseover=&quot;alert(1)')
  })
})

describe('getBasicEmailContent', () => {
  it('renders the message without the retired endorsements footer', () => {
    const html = getBasicEmailContent('Hello there', 'A subject')

    expect(html).toContain('Hello there')
    expect(html).not.toContain('endorsements')
    expect(html).not.toContain('goodparty.org/profile')
  })
})

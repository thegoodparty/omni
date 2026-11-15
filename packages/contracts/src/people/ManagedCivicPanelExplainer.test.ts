import { describe, expect, it } from 'vitest'
import {
  managedCivicPanelHeadsUpLine,
  managedCivicPanelHeadsUpPost,
} from './ManagedCivicPanelExplainer'

describe('managedCivicPanelHeadsUpPost', () => {
  it('names the place and signs with the name and office', () => {
    expect(
      managedCivicPanelHeadsUpPost({
        place: 'Asheville',
        name: 'Jordan Rivera',
        office: 'Asheville City Council',
      }),
    ).toBe(
      "I'm partnering with GoodParty.org, a public good corporation focused on representative democracy, to hear from more of Asheville. Over the next few weeks, some residents will get a text from me inviting them to join my civic panel. I want to hear from people across Asheville, not just those who can make it to public meetings. If you get one, reply JOIN to share your perspective.\n\nJordan Rivera, Asheville City Council",
    )
  })

  it('reads without a place, and signs with whatever it knows', () => {
    const post = managedCivicPanelHeadsUpPost({
      place: null,
      name: 'Jordan Rivera',
      office: null,
    })
    expect(post).toContain('to hear from more of our community.')
    expect(post.endsWith('\n\nJordan Rivera')).toBe(true)
    expect(
      managedCivicPanelHeadsUpPost({ place: null, name: null, office: null }),
    ).toMatch(/share your perspective\.$/)
  })
})

describe('managedCivicPanelHeadsUpLine', () => {
  it('names the first send day and the place', () => {
    expect(
      managedCivicPanelHeadsUpLine({
        place: 'Asheville',
        firstSendDay: 'Tuesday',
      }),
    ).toBe(
      "People are more likely to answer a text they've heard is coming. Post this on your most active social channels before Tuesday so Asheville knows the invites are from you.",
    )
    expect(
      managedCivicPanelHeadsUpLine({ place: null, firstSendDay: 'Tuesday' }),
    ).toMatch(/so residents know the invites are from you\.$/)
  })
})

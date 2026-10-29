import { describe, expect, it } from 'vitest'
import { servePartyFromCampaign } from './winParty'

describe('servePartyFromCampaign', () => {
  it.each([
    [{ party: 'independent' }, 'independent'],
    [{ party: 'nonpartisan' }, 'nonpartisan'],
    // The profile dialog's labels.
    [{ party: 'Non-partisan' }, 'nonpartisan'],
    [{ party: 'Independent' }, 'independent'],
    [{ party: 'Libertarian Party' }, 'independent'],
    // "Other" keeps the name in otherParty, and Test mode sets only that.
    [{ party: 'Other', otherParty: 'Working Families' }, 'independent'],
    [{ otherParty: 'Independent' }, 'independent'],
    // Majors keep their own option, so the party step can show and block it.
    [{ party: 'democrat' }, 'democratic'],
    [{ party: 'Democratic Party' }, 'democratic'],
    [{ party: 'republican' }, 'republican'],
    [{}, undefined],
    [{ party: '' }, undefined],
    [{ party: 'Other' }, undefined],
    [undefined, undefined],
  ])('maps %j to %s', (details, expected) => {
    expect(servePartyFromCampaign(details)).toBe(expected)
  })
})

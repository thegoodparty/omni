import { describe, it, expect } from 'vitest'
import { Campaign } from 'helpers/types'
import { getDashboardMenuItems } from './DashboardMenu'

const proCampaign = { id: 1, isPro: true } as unknown as Campaign
const freeCampaign = { id: 1, isPro: false } as unknown as Campaign

const links = (
  campaign: Campaign | null,
  {
    serveAccessEnabled = false,
    isElectedOffice = false,
    winVoterDataEnabled = false,
    campaignStoryEnabled = false,
  }: {
    serveAccessEnabled?: boolean
    isElectedOffice?: boolean
    winVoterDataEnabled?: boolean
    campaignStoryEnabled?: boolean
  } = {},
) =>
  getDashboardMenuItems(
    campaign,
    serveAccessEnabled,
    isElectedOffice,
    false,
    false,
    winVoterDataEnabled,
    campaignStoryEnabled,
  )

describe('getDashboardMenuItems — Win Contacts gating', () => {
  it('shows the Contacts item for a pro Win campaign when win-voter-data is on', () => {
    const items = links(proCampaign, { winVoterDataEnabled: true })

    const contacts = items.find((i) => i.id === 'win-contacts-dashboard')
    expect(contacts).toBeDefined()
    expect(contacts?.link).toBe('/dashboard/contacts')
    // Win orgs render under the 'campaign' category, so the item must be
    // categorized there to survive the sidebar's category filter.
    expect(contacts?.v2Category).toBe('campaign')
    // Win reads "Voter Data" (v2Name is the displayed label), never
    // "Constituents" (ENG-10448).
    expect(contacts?.v2Name).toBe('Voter Data')
    expect(items.some((i) => i.link === '/dashboard/voter-records')).toBe(false)
  })

  it('shows the legacy Voter Data item (not Contacts) when the flag is off', () => {
    const items = links(proCampaign, { winVoterDataEnabled: false })

    expect(items.some((i) => i.link === '/dashboard/voter-records')).toBe(true)
    expect(items.some((i) => i.id === 'win-contacts-dashboard')).toBe(false)
  })

  it('does not show Contacts for a non-pro Win campaign even with the flag on', () => {
    const items = links(freeCampaign, { winVoterDataEnabled: true })

    expect(items.some((i) => i.id === 'win-contacts-dashboard')).toBe(false)
    expect(items.some((i) => i.id === 'upgrade-pro-dashboard')).toBe(true)
  })

  it('leaves Serve/elected-office Contacts gating unchanged regardless of the Win flag', () => {
    const withFlag = links(proCampaign, {
      serveAccessEnabled: true,
      isElectedOffice: true,
      winVoterDataEnabled: true,
    })
    const withoutFlag = links(proCampaign, {
      serveAccessEnabled: true,
      isElectedOffice: true,
      winVoterDataEnabled: false,
    })

    for (const items of [withFlag, withoutFlag]) {
      const contacts = items.find((i) => i.id === 'contacts-dashboard')
      expect(contacts).toBeDefined()
      expect(contacts?.v2Category).toBe('elected-office')
      // Serve reads "Constituent Data" in the sidebar (ENG-10448).
      expect(contacts?.v2Name).toBe('Constituent Data')
      // The Win-specific item must never appear on the Serve path.
      expect(items.some((i) => i.id === 'win-contacts-dashboard')).toBe(false)
    }
  })
})

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
    isElectedOfficeLoading = false,
    winVoterDataReady = true,
    winVoterDataEnabled = false,
    campaignStoryEnabled = false,
    communityIssuesEnabled = true,
    knowYourOpponentEnabled = false,
  }: {
    serveAccessEnabled?: boolean
    isElectedOffice?: boolean
    isElectedOfficeLoading?: boolean
    winVoterDataReady?: boolean
    winVoterDataEnabled?: boolean
    campaignStoryEnabled?: boolean
    communityIssuesEnabled?: boolean
    knowYourOpponentEnabled?: boolean
  } = {},
) =>
  getDashboardMenuItems(
    campaign,
    serveAccessEnabled,
    isElectedOffice,
    isElectedOfficeLoading,
    false,
    winVoterDataReady,
    winVoterDataEnabled,
    campaignStoryEnabled,
    communityIssuesEnabled,
    knowYourOpponentEnabled,
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

  it('does not commit to the Win "Voter Data" item while the elected-office query is loading', () => {
    // A Serve elected-official reads as not-elected-office until the query
    // settles; selecting WIN_CONTACTS during that window would flash "Voter
    // Data" at them. Hold the generic placeholder instead (ENG-10448).
    const items = links(proCampaign, {
      winVoterDataEnabled: true,
      isElectedOfficeLoading: true,
    })

    expect(items.some((i) => i.id === 'win-contacts-dashboard')).toBe(false)
    expect(items.some((i) => i.link === '/dashboard/voter-records')).toBe(false)
    expect(items.some((i) => i.id === 'upgrade-pro-dashboard')).toBe(true)
  })

  it('holds the placeholder (no legacy item, no Contacts) while the win-voter-data flag is still loading', () => {
    // Until the flag's `ready` settles it reads off, so committing now would
    // show the legacy Voter Data item and then swap it to Contacts once the
    // flag resolves. Hold the generic placeholder until ready (ENG-10448).
    const items = links(proCampaign, {
      winVoterDataReady: false,
      winVoterDataEnabled: false,
    })

    expect(items.some((i) => i.id === 'win-contacts-dashboard')).toBe(false)
    expect(items.some((i) => i.link === '/dashboard/voter-records')).toBe(false)
    expect(items.some((i) => i.id === 'upgrade-pro-dashboard')).toBe(true)
  })

  it('shows Contacts for a non-pro Win campaign when the flag is on', () => {
    // ENG-10495: non-pro Win candidates land on the unified Contacts page so
    // they see the district aggregates + a blurred preview and get upsold there.
    const items = links(freeCampaign, { winVoterDataEnabled: true })

    const contacts = items.find((i) => i.id === 'win-contacts-dashboard')
    expect(contacts).toBeDefined()
    expect(contacts?.link).toBe('/dashboard/contacts')
    expect(items.some((i) => i.id === 'upgrade-pro-dashboard')).toBe(false)
  })

  it('keeps the upgrade placeholder for a non-pro Win campaign when the flag is off', () => {
    // Flag-off non-pro users have no legacy voter-records access (that page
    // stays pro-only), so the generic upgrade placeholder holds the slot.
    const items = links(freeCampaign, { winVoterDataEnabled: false })

    expect(items.some((i) => i.id === 'win-contacts-dashboard')).toBe(false)
    expect(items.some((i) => i.link === '/dashboard/voter-records')).toBe(false)
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

describe('getDashboardMenuItems — Campaign Plan vs Story order', () => {
  it('renders Campaign Plan before Campaign Story when both are present', () => {
    const items = getDashboardMenuItems(
      proCampaign,
      false, // serveAccessEnabled
      false, // isElectedOffice
      false, // isElectedOfficeLoading
      true, // campaignStrategyExists
      true, // winVoterDataReady
      false, // winVoterDataEnabled
      true, // campaignStoryEnabled
      false, // communityIssuesEnabled
      false, // knowYourOpponentEnabled
    )
    const planIdx = items.findIndex((i) => i.id === 'campaign-plan-dashboard')
    const storyIdx = items.findIndex((i) => i.id === 'campaign-story-dashboard')

    expect(planIdx).toBeGreaterThanOrEqual(0)
    expect(storyIdx).toBeGreaterThanOrEqual(0)
    expect(planIdx).toBeLessThan(storyIdx)
  })
})

describe('getDashboardMenuItems — Website tab retired (ENG-10505)', () => {
  it('never includes the Website nav item for a pro campaign', () => {
    const items = links(proCampaign)
    expect(items.some((i) => i.id === 'website-dashboard')).toBe(false)
    expect(items.some((i) => i.link === '/dashboard/website')).toBe(false)
  })

  it('never includes the Website nav item for a free campaign', () => {
    const items = links(freeCampaign)
    expect(items.some((i) => i.id === 'website-dashboard')).toBe(false)
    expect(items.some((i) => i.link === '/dashboard/website')).toBe(false)
  })
})

describe('getDashboardMenuItems — Know your opponent nav gating', () => {
  it('shows the nav item when the flag is on and the campaign is Pro', () => {
    const items = links(proCampaign, { knowYourOpponentEnabled: true })
    const item = items.find((i) => i.id === 'race-opponent-dashboard')
    expect(item).toBeDefined()
    expect(item?.link).toBe('/dashboard/race-opponent')
    expect(item?.v2Category).toBe('campaign')
  })

  it('hides the nav item when the flag is off', () => {
    const items = links(proCampaign, { knowYourOpponentEnabled: false })
    expect(items.some((i) => i.id === 'race-opponent-dashboard')).toBe(false)
  })

  it('hides the nav item for a non-pro campaign even when the flag is on', () => {
    const items = links(freeCampaign, { knowYourOpponentEnabled: true })
    expect(items.some((i) => i.id === 'race-opponent-dashboard')).toBe(false)
  })
})

describe('getDashboardMenuItems — Community Issues nav gating', () => {
  it('shows the Community Issues nav for an elected office when the flag is on', () => {
    const items = links(proCampaign, {
      isElectedOffice: true,
      communityIssuesEnabled: true,
    })
    expect(items.some((i) => i.id === 'community-issues-dashboard')).toBe(true)
  })

  it('hides the Community Issues nav for an elected office when the flag is off', () => {
    const items = links(proCampaign, {
      isElectedOffice: true,
      communityIssuesEnabled: false,
    })
    expect(items.some((i) => i.id === 'community-issues-dashboard')).toBe(false)
  })

  it('hides the Community Issues nav for a non-elected-office user even when the flag is on', () => {
    const items = links(proCampaign, {
      isElectedOffice: false,
      communityIssuesEnabled: true,
    })
    expect(items.some((i) => i.id === 'community-issues-dashboard')).toBe(false)
  })

  it('keeps Campaign Plan before Story when the flag hides Community Issues for an elected office', () => {
    // With Community Issues hidden, the front-of-list offset drops by one;
    // the campaign-category items must still render in order.
    const items = links(proCampaign, {
      isElectedOffice: true,
      communityIssuesEnabled: false,
      campaignStoryEnabled: true,
    })
    expect(items.some((i) => i.id === 'community-issues-dashboard')).toBe(false)
    const planIdx = items.findIndex((i) => i.id === 'campaign-plan-dashboard')
    const storyIdx = items.findIndex((i) => i.id === 'campaign-story-dashboard')
    expect(planIdx).toBeGreaterThanOrEqual(0)
    expect(storyIdx).toBeGreaterThanOrEqual(0)
    expect(planIdx).toBeLessThan(storyIdx)
  })
})

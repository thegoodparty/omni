import { describe, it, expect } from 'vitest'
import { getDashboardMenuItems } from './DashboardMenu'

const links = ({
  isElectedOffice = false,
  isElectedOfficeLoading = false,
  campaignStoryEnabled = false,
  serveOutreachEnabled = false,
}: {
  isElectedOffice?: boolean
  isElectedOfficeLoading?: boolean
  campaignStoryEnabled?: boolean
  serveOutreachEnabled?: boolean
} = {}) =>
  getDashboardMenuItems(
    isElectedOffice,
    isElectedOfficeLoading,
    false,
    campaignStoryEnabled,
    serveOutreachEnabled,
  )

describe('getDashboardMenuItems — Win Contacts gating', () => {
  it('shows the Contacts item for a Win campaign, pro or not', () => {
    // ENG-10495: non-pro Win candidates land on the same unified Contacts page
    // so they see the district aggregates + a blurred preview and get upsold
    // there — the menu item is identical for pro and non-pro.
    const items = links()

    const contacts = items.find((i) => i.id === 'win-contacts-dashboard')
    expect(contacts).toBeDefined()
    expect(contacts?.link).toBe('/dashboard/contacts')
    // Win orgs render under the 'campaign' category, so the item must be
    // categorized there to survive the sidebar's category filter.
    expect(contacts?.v2Category).toBe('campaign')
    // Win reads "Voter Data" (v2Name is the displayed label), never
    // "Constituents" (ENG-10448).
    expect(contacts?.v2Name).toBe('Voter Data')
    expect(items.some((i) => i.id === 'upgrade-pro-dashboard')).toBe(false)
  })

  it('does not commit to the Win "Voter Data" item while the elected-office query is loading', () => {
    // A Serve elected-official reads as not-elected-office until the query
    // settles; selecting WIN_CONTACTS during that window would flash "Voter
    // Data" at them. Hold the generic placeholder instead (ENG-10448).
    const items = links({
      isElectedOfficeLoading: true,
    })

    expect(items.some((i) => i.id === 'win-contacts-dashboard')).toBe(false)
    expect(items.some((i) => i.id === 'upgrade-pro-dashboard')).toBe(true)
  })

  it('leaves Serve/elected-office Contacts gating unchanged', () => {
    const items = links({
      isElectedOffice: true,
    })

    const contacts = items.find((i) => i.id === 'contacts-dashboard')
    expect(contacts).toBeDefined()
    expect(contacts?.v2Category).toBe('elected-office')
    // Serve reads "Constituent Data" in the sidebar (ENG-10448).
    expect(contacts?.v2Name).toBe('Constituent Data')
    // The Win-specific item must never appear on the Serve path.
    expect(items.some((i) => i.id === 'win-contacts-dashboard')).toBe(false)
  })
})

describe('getDashboardMenuItems: "Your story" sidebar item', () => {
  it('renders "Your story" just above the tracker when the story flag is on', () => {
    const items = getDashboardMenuItems(
      false, // isElectedOffice
      false, // isElectedOfficeLoading
      true, // campaignStrategyExists
      true, // campaignStoryEnabled
      false, // serveOutreachEnabled
    )
    const storyIdx = items.findIndex((i) => i.id === 'campaign-story-dashboard')
    const planIdx = items.findIndex((i) => i.id === 'campaign-plan-dashboard')

    expect(storyIdx).toBeGreaterThanOrEqual(0)
    expect(items[storyIdx]?.label).toBe('Your story')
    // It sits directly above the Campaign Plan tab.
    expect(planIdx).toBe(storyIdx + 1)
  })

  it('omits "Your story" when the story flag is off', () => {
    const items = getDashboardMenuItems(
      false, // isElectedOffice
      false, // isElectedOfficeLoading
      true, // campaignStrategyExists
      false, // campaignStoryEnabled
      false, // serveOutreachEnabled
    )
    expect(
      items.find((i) => i.id === 'campaign-story-dashboard'),
    ).toBeUndefined()
  })
})

describe('getDashboardMenuItems — Campaign Plan tab label', () => {
  it('labels the item "Campaign Plan" when campaignStoryEnabled is true', () => {
    const items = links({ campaignStoryEnabled: true })
    const planItem = items.find((i) => i.id === 'campaign-plan-dashboard')
    expect(planItem?.label).toBe('Campaign Plan')
  })

  it('labels the item "Campaign Plan" when campaignStoryEnabled is false', () => {
    // Story off: the item only appears when a campaign strategy exists, so pass
    // that flag (position 2) directly rather than via the `links` helper.
    const items = getDashboardMenuItems(
      false, // isElectedOffice
      false, // isElectedOfficeLoading
      true, // campaignStrategyExists
      false, // campaignStoryEnabled
      false, // serveOutreachEnabled
    )
    const planItem = items.find((i) => i.id === 'campaign-plan-dashboard')
    expect(planItem?.label).toBe('Campaign Plan')
  })
})

describe('getDashboardMenuItems — Website tab retired (ENG-10505)', () => {
  it('never includes the Website nav item', () => {
    const items = links()
    expect(items.some((i) => i.id === 'website-dashboard')).toBe(false)
    expect(items.some((i) => i.link === '/dashboard/website')).toBe(false)
  })
})

describe('getDashboardMenuItems — Know Your Opponent nav', () => {
  it('shows the nav item for a campaign (content is gated at the route, not the nav)', () => {
    const items = links()
    const item = items.find((i) => i.id === 'race-opponent-dashboard')
    expect(item).toBeDefined()
    expect(item?.label).toBe('Know Your Opponent')
    expect(item?.link).toBe('/dashboard/race-opponent')
    expect(item?.v2Category).toBe('campaign')
  })
})

describe('getDashboardMenuItems — Chief of Staff nav gating', () => {
  it('shows the Chief of Staff item for an elected office', () => {
    const items = links({
      isElectedOffice: true,
    })
    expect(items.some((i) => i.id === 'chief-of-staff-dashboard')).toBe(true)
  })

  it('hides the Chief of Staff item when not elected office', () => {
    const items = links({
      isElectedOffice: false,
    })
    expect(items.some((i) => i.id === 'chief-of-staff-dashboard')).toBe(false)
  })

  it('renders Chief of Staff before Briefing Assistant when both are shown', () => {
    const items = links({
      isElectedOffice: true,
    })
    const cosIdx = items.findIndex((i) => i.id === 'chief-of-staff-dashboard')
    const briefingsIdx = items.findIndex((i) => i.id === 'briefings-dashboard')
    expect(cosIdx).toBeGreaterThanOrEqual(0)
    expect(briefingsIdx).toBeGreaterThanOrEqual(0)
    expect(cosIdx).toBeLessThan(briefingsIdx)
  })
})

describe('getDashboardMenuItems — Community Issues nav gating', () => {
  it('shows the Community Issues nav for an elected office', () => {
    const items = links({
      isElectedOffice: true,
    })
    expect(items.some((i) => i.id === 'community-issues-dashboard')).toBe(true)
  })

  it('hides the Community Issues nav for a non-elected-office user', () => {
    const items = links({
      isElectedOffice: false,
    })
    expect(items.some((i) => i.id === 'community-issues-dashboard')).toBe(false)
  })

  it('still renders Campaign Plan alongside Community Issues for an elected office', () => {
    const items = links({
      isElectedOffice: true,
      campaignStoryEnabled: true,
    })
    expect(items.some((i) => i.id === 'community-issues-dashboard')).toBe(true)
    const planIdx = items.findIndex((i) => i.id === 'campaign-plan-dashboard')
    expect(planIdx).toBeGreaterThanOrEqual(0)
  })
})

describe('getDashboardMenuItems — Ordinances tab gating', () => {
  it('shows the Ordinances item for an elected office', () => {
    const items = links({
      isElectedOffice: true,
    })
    expect(items.some((i) => i.id === 'ordinances-dashboard')).toBe(true)
  })

  it('hides the Ordinances item for a non-elected office', () => {
    const items = links({
      isElectedOffice: false,
    })
    expect(items.some((i) => i.id === 'ordinances-dashboard')).toBe(false)
  })
})

describe('getDashboardMenuItems — Constituent Outreach nav gating', () => {
  it('shows the item for an elected office when the flag is on', () => {
    const items = links({
      isElectedOffice: true,
      serveOutreachEnabled: true,
    })
    expect(items.some((i) => i.id === 'constituent-outreach-dashboard')).toBe(
      true,
    )
  })

  it('hides the item when the flag is off', () => {
    const items = links({
      isElectedOffice: true,
      serveOutreachEnabled: false,
    })
    expect(items.some((i) => i.id === 'constituent-outreach-dashboard')).toBe(
      false,
    )
  })

  it('hides the item for a campaign (non-elected-office) org even when the flag is on', () => {
    const items = links({
      isElectedOffice: false,
      serveOutreachEnabled: true,
    })
    expect(items.some((i) => i.id === 'constituent-outreach-dashboard')).toBe(
      false,
    )
  })
})

describe('getDashboardMenuItems — Door Knocking has no standalone nav item', () => {
  // Door knocking is a channel of Voter Outreach, not a peer of it: the outreach
  // hub's channel tile (`v2/ChannelTileGrid.tsx`) is the only entry, since it's
  // the only one that can carry a saved list across as `?listId=`.
  it('never includes a door-knocking item', () => {
    const items = links({ isElectedOffice: true })
    expect(items.some((i) => i.id === 'door-knocking-dashboard')).toBe(false)
  })
})

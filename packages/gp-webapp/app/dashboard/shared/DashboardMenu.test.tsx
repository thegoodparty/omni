import { describe, it, expect } from 'vitest'
import { getDashboardMenuItems } from './DashboardMenu'

const links = ({
  serveAccessEnabled = false,
  isElectedOffice = false,
  isElectedOfficeLoading = false,
  campaignStoryEnabled = false,
  communityIssuesEnabled = true,
  ordinancesEnabled = false,
}: {
  serveAccessEnabled?: boolean
  isElectedOffice?: boolean
  isElectedOfficeLoading?: boolean
  campaignStoryEnabled?: boolean
  communityIssuesEnabled?: boolean
  ordinancesEnabled?: boolean
} = {}) =>
  getDashboardMenuItems(
    serveAccessEnabled,
    isElectedOffice,
    isElectedOfficeLoading,
    false,
    campaignStoryEnabled,
    communityIssuesEnabled,
    ordinancesEnabled,
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
      serveAccessEnabled: true,
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

describe('getDashboardMenuItems: Campaign Story sidebar item removed', () => {
  it('does not render a Campaign Story sidebar item even when the story flag is on', () => {
    const items = getDashboardMenuItems(
      false, // serveAccessEnabled
      false, // isElectedOffice
      false, // isElectedOfficeLoading
      true, // campaignStrategyExists
      true, // campaignStoryEnabled
      false, // communityIssuesEnabled
      false, // ordinancesEnabled
    )
    const planIdx = items.findIndex((i) => i.id === 'campaign-plan-dashboard')

    expect(planIdx).toBeGreaterThanOrEqual(0)
    expect(
      items.find((i) => i.id === 'campaign-story-dashboard'),
    ).toBeUndefined()
  })
})

describe('getDashboardMenuItems — Campaign Plan tab label', () => {
  it('labels the item "Campaign Tracker" when campaignStoryEnabled is true', () => {
    const items = links({ campaignStoryEnabled: true })
    const planItem = items.find((i) => i.id === 'campaign-plan-dashboard')
    expect(planItem?.label).toBe('Campaign Tracker')
  })

  it('labels the item "Campaign Plan" when campaignStoryEnabled is false', () => {
    // Story off: the item only appears when a campaign strategy exists, so pass
    // that flag (position 4) directly rather than via the `links` helper.
    const items = getDashboardMenuItems(
      false, // serveAccessEnabled
      false, // isElectedOffice
      false, // isElectedOfficeLoading
      true, // campaignStrategyExists
      false, // campaignStoryEnabled
      false, // communityIssuesEnabled
      false, // ordinancesEnabled
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
  it('shows the Chief of Staff item when serve-access + elected-office', () => {
    const items = links({
      serveAccessEnabled: true,
      isElectedOffice: true,
    })
    expect(items.some((i) => i.id === 'chief-of-staff-dashboard')).toBe(true)
  })

  it('hides the Chief of Staff item when serve-access is off', () => {
    const items = links({
      serveAccessEnabled: false,
      isElectedOffice: true,
    })
    expect(items.some((i) => i.id === 'chief-of-staff-dashboard')).toBe(false)
  })

  it('hides the Chief of Staff item when not elected office', () => {
    const items = links({
      serveAccessEnabled: true,
      isElectedOffice: false,
    })
    expect(items.some((i) => i.id === 'chief-of-staff-dashboard')).toBe(false)
  })

  it('renders Chief of Staff before Briefing Assistant when both are shown', () => {
    const items = links({
      serveAccessEnabled: true,
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
  it('shows the Community Issues nav for an elected office when the flag is on', () => {
    const items = links({
      isElectedOffice: true,
      communityIssuesEnabled: true,
    })
    expect(items.some((i) => i.id === 'community-issues-dashboard')).toBe(true)
  })

  it('hides the Community Issues nav for an elected office when the flag is off', () => {
    const items = links({
      isElectedOffice: true,
      communityIssuesEnabled: false,
    })
    expect(items.some((i) => i.id === 'community-issues-dashboard')).toBe(false)
  })

  it('hides the Community Issues nav for a non-elected-office user even when the flag is on', () => {
    const items = links({
      isElectedOffice: false,
      communityIssuesEnabled: true,
    })
    expect(items.some((i) => i.id === 'community-issues-dashboard')).toBe(false)
  })

  it('still renders Campaign Plan when the flag hides Community Issues for an elected office', () => {
    // With Community Issues hidden, the front-of-list offset drops by one;
    // the campaign-category items must still render in order.
    const items = links({
      isElectedOffice: true,
      communityIssuesEnabled: false,
      campaignStoryEnabled: true,
    })
    expect(items.some((i) => i.id === 'community-issues-dashboard')).toBe(false)
    const planIdx = items.findIndex((i) => i.id === 'campaign-plan-dashboard')
    expect(planIdx).toBeGreaterThanOrEqual(0)
  })
})

describe('getDashboardMenuItems — Ordinances tab gating', () => {
  it('shows the Ordinances item for an elected office when the flag is on', () => {
    const items = links({
      isElectedOffice: true,
      ordinancesEnabled: true,
    })
    expect(items.some((i) => i.id === 'ordinances-dashboard')).toBe(true)
  })

  it('hides the Ordinances item when the flag is off', () => {
    const items = links({
      isElectedOffice: true,
      ordinancesEnabled: false,
    })
    expect(items.some((i) => i.id === 'ordinances-dashboard')).toBe(false)
  })

  it('hides the Ordinances item for a non-elected office even with the flag on', () => {
    const items = links({
      isElectedOffice: false,
      ordinancesEnabled: true,
    })
    expect(items.some((i) => i.id === 'ordinances-dashboard')).toBe(false)
  })
})

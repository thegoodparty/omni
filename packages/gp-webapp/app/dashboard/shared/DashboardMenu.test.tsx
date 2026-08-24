import { describe, it, expect } from 'vitest'
import { getDashboardMenuItems } from './DashboardMenu'

const links = ({
  serveAccessEnabled = false,
  isElectedOffice = false,
  isElectedOfficeLoading = false,
  campaignStoryEnabled = false,
  communityIssuesEnabled = true,
  ordinancesEnabled = false,
  ecanvasserConnected = false,
  nativeEnabled = false,
  districtResolvable = true,
  proAccess = true,
}: {
  serveAccessEnabled?: boolean
  isElectedOffice?: boolean
  isElectedOfficeLoading?: boolean
  campaignStoryEnabled?: boolean
  communityIssuesEnabled?: boolean
  ordinancesEnabled?: boolean
  ecanvasserConnected?: boolean
  nativeEnabled?: boolean
  districtResolvable?: boolean
  proAccess?: boolean
} = {}) =>
  getDashboardMenuItems(
    serveAccessEnabled,
    isElectedOffice,
    isElectedOfficeLoading,
    false,
    campaignStoryEnabled,
    communityIssuesEnabled,
    ordinancesEnabled,
    { ecanvasserConnected, nativeEnabled, districtResolvable, proAccess },
  )

const hasDoorKnocking = (options: Parameters<typeof links>[0] = {}): boolean =>
  links(options).some((item) => item.id === 'door-knocking-dashboard')

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

describe('getDashboardMenuItems: "Your story" sidebar item', () => {
  it('renders "Your story" just above the tracker when the story flag is on', () => {
    const items = getDashboardMenuItems(
      false, // serveAccessEnabled
      false, // isElectedOffice
      false, // isElectedOfficeLoading
      true, // campaignStrategyExists
      true, // campaignStoryEnabled
      false, // communityIssuesEnabled
      false, // ordinancesEnabled
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
      false, // serveAccessEnabled
      false, // isElectedOffice
      false, // isElectedOfficeLoading
      true, // campaignStrategyExists
      false, // campaignStoryEnabled
      false, // communityIssuesEnabled
      false, // ordinancesEnabled
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

describe('getDashboardMenuItems — Door Knocking nav gating', () => {
  // The regression this gating fixes: the link used to be pushed only for orgs
  // with an eCanvasser integration record, so a pilot candidate on the native
  // flag had no way to reach the feature at all.
  it('shows the item on the native flag without an eCanvasser record', () => {
    expect(hasDoorKnocking({ nativeEnabled: true })).toBe(true)
  })

  it('hides the item with neither the flag nor an eCanvasser record', () => {
    expect(hasDoorKnocking()).toBe(false)
  })

  it('still shows the legacy item for an integrated org with the flag off', () => {
    expect(hasDoorKnocking({ ecanvasserConnected: true })).toBe(true)
  })

  // Every pack and turf read resolves a district server-side and 400s without
  // one, so the native map would render an error, not a walk list.
  it('hides the item on the native flag when the district is unresolvable', () => {
    expect(
      hasDoorKnocking({ nativeEnabled: true, districtResolvable: false }),
    ).toBe(false)
  })

  // Flag on means the route renders the native map regardless of eCanvasser, so
  // an integrated org with no district would land on the same error page.
  it('does not let an eCanvasser record rescue the item on the native flag', () => {
    expect(
      hasDoorKnocking({
        nativeEnabled: true,
        ecanvasserConnected: true,
        districtResolvable: false,
      }),
    ).toBe(false)
  })

  // While the flag is unsettled the page renders the eCanvasser dashboard, so
  // the nav must match rather than flashing a link that changes meaning.
  it('ignores district resolution while the flag is unsettled', () => {
    expect(hasDoorKnocking({ districtResolvable: true })).toBe(false)
    expect(
      hasDoorKnocking({ ecanvasserConnected: true, districtResolvable: false }),
    ).toBe(true)
  })

  // ENG-10888: every native route is Pro-gated in gp-api, so the link would
  // only reach an upgrade prompt.
  it('hides the item on the native flag for a non-Pro org', () => {
    expect(hasDoorKnocking({ nativeEnabled: true, proAccess: false })).toBe(
      false,
    )
  })

  it('shows the item on the native flag for a Pro org', () => {
    expect(hasDoorKnocking({ nativeEnabled: true, proAccess: true })).toBe(true)
  })

  // Same reason an eCanvasser record can't rescue a missing district: the flag
  // decides which product the route renders, and the native one needs both.
  it('does not let an eCanvasser record rescue a non-Pro org on the flag', () => {
    expect(
      hasDoorKnocking({
        nativeEnabled: true,
        ecanvasserConnected: true,
        proAccess: false,
      }),
    ).toBe(false)
  })

  // The control path is entitlement-free and stays that way — the legacy
  // eCanvasser dashboard was never Pro-gated and this change must not gate it.
  it('leaves the legacy item visible for a non-Pro integrated org', () => {
    expect(
      hasDoorKnocking({ ecanvasserConnected: true, proAccess: false }),
    ).toBe(true)
  })
})

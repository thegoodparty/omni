import { describe, it, expect } from 'vitest'
import { getDashboardMenuItems } from './DashboardMenu'

const links = ({
  isElectedOffice = false,
  isElectedOfficeLoading = false,
  prioritiesEnabled = false,
}: {
  isElectedOffice?: boolean
  isElectedOfficeLoading?: boolean
  prioritiesEnabled?: boolean
} = {}) =>
  getDashboardMenuItems(
    isElectedOffice,
    isElectedOfficeLoading,
    prioritiesEnabled,
  )

describe('getDashboardMenuItems — Win Contacts gating', () => {
  it('shows the Contacts item for a Win campaign, pro or not', () => {
    // ENG-10495: non-pro Win candidates land on the same unified Contacts page
    // so they see the district aggregates + a blurred preview and get upsold
    // there — the menu item is identical for pro and non-pro.
    const items = links()

    const contacts = items.find((i) => i.id === 'win-contacts-dashboard')
    expect(contacts).toBeDefined()
    expect(contacts?.link).toBe('/contacts')
    // Win orgs render under the 'campaign' category, so the item must be
    // categorized there to survive the sidebar's category filter.
    expect(contacts?.v2Category).toBe('campaign')
    // Win reads "Voters" (v2Name is the displayed label), never
    // "Constituents" (ENG-10448).
    expect(contacts?.v2Name).toBe('Voters')
    expect(items.some((i) => i.id === 'upgrade-pro-dashboard')).toBe(false)
  })

  it('does not commit to the Win "Voters" item while the elected-office query is loading', () => {
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

describe('getDashboardMenuItems: "Your Story" sidebar item', () => {
  it('opens with Home, Game Plan, Outreach and Voters, then Your Story', () => {
    const items = links()
    const campaignTabs = items
      .filter((i) => i.v2Category === 'campaign')
      .map((i) => i.id)

    expect(campaignTabs.slice(0, 5)).toEqual([
      'campaign-tracker-dashboard',
      'campaign-plan-dashboard',
      'outreach-dashboard',
      'win-contacts-dashboard',
      'campaign-story-dashboard',
    ])
    expect(items.find((i) => i.id === 'campaign-story-dashboard')?.label).toBe(
      'Your Story',
    )
  })
})

describe('getDashboardMenuItems — Game Plan tab label', () => {
  it('always labels the item "Game Plan"', () => {
    const items = links()
    const planItem = items.find((i) => i.id === 'campaign-plan-dashboard')
    expect(planItem?.label).toBe('Game Plan')
  })
})

describe('getDashboardMenuItems — Website tab retired (ENG-10505)', () => {
  it('never includes the Website nav item', () => {
    const items = links()
    expect(items.some((i) => i.id === 'website-dashboard')).toBe(false)
    expect(items.some((i) => i.link === '/website')).toBe(false)
  })
})

describe('getDashboardMenuItems — Know Your Opponent nav', () => {
  it('shows the nav item for a campaign (content is gated at the route, not the nav)', () => {
    const items = links()
    const item = items.find((i) => i.id === 'race-opponent-dashboard')
    expect(item).toBeDefined()
    expect(item?.label).toBe('Know Your Opponent')
    expect(item?.link).toBe('/race-opponent')
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

  it('still renders Game Plan alongside Community Issues for an elected office', () => {
    const items = links({
      isElectedOffice: true,
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

describe('getDashboardMenuItems — Priorities tab gating', () => {
  it('shows Priorities for an elected office with the flag on', () => {
    const items = links({ isElectedOffice: true, prioritiesEnabled: true })
    expect(items.some((i) => i.id === 'priorities-dashboard')).toBe(true)
  })

  it('hides Priorities while the flag is off', () => {
    const items = links({ isElectedOffice: true, prioritiesEnabled: false })
    expect(items.some((i) => i.id === 'priorities-dashboard')).toBe(false)
  })

  it('hides Priorities for a non-elected office even with the flag on', () => {
    const items = links({ isElectedOffice: false, prioritiesEnabled: true })
    expect(items.some((i) => i.id === 'priorities-dashboard')).toBe(false)
  })

  it('sits directly under Chief of Staff in the Serve rail', () => {
    const serveRail = links({
      isElectedOffice: true,
      prioritiesEnabled: true,
    }).filter((i) => i.v2Category === 'elected-office')
    expect(serveRail[0]?.id).toBe('chief-of-staff-dashboard')
    expect(serveRail[1]?.id).toBe('priorities-dashboard')
  })

  it('keeps Game Plan under Home when Priorities shows', () => {
    const items = links({ isElectedOffice: true, prioritiesEnabled: true })
    const home = items.findIndex((i) => i.id === 'campaign-tracker-dashboard')
    expect(items[home + 1]?.id).toBe('campaign-plan-dashboard')
  })
})

describe('getDashboardMenuItems — Constituent Outreach nav gating', () => {
  it('shows the item for an elected office', () => {
    const items = links({
      isElectedOffice: true,
    })
    expect(items.some((i) => i.id === 'constituent-outreach-dashboard')).toBe(
      true,
    )
  })

  it('hides the item for a campaign (non-elected-office) org', () => {
    const items = links({
      isElectedOffice: false,
    })
    expect(items.some((i) => i.id === 'constituent-outreach-dashboard')).toBe(
      false,
    )
  })

  it('does not commit to the item while the elected-office query is loading', () => {
    const items = links({
      isElectedOffice: false,
      isElectedOfficeLoading: true,
    })
    expect(items.some((i) => i.id === 'constituent-outreach-dashboard')).toBe(
      false,
    )
  })
})

// ENG-11061: Team moved out of getDashboardMenuItems (the primary nav)
// entirely — it now lives in the sidebar account menu, which reads
// showTeamAccountItem directly in DashboardMenu rather than through this
// pure function. Coverage for that gating lives in
// DashboardMenu.accountGating.test.tsx.
describe('getDashboardMenuItems — Team not a primary-nav item (ENG-11061)', () => {
  it('never includes a team item, elected office or not', () => {
    const isTeamItem = (i: { id: string }) => i.id === 'team-dashboard'
    expect(links({ isElectedOffice: false }).some(isTeamItem)).toBe(false)
    expect(links({ isElectedOffice: true }).some(isTeamItem)).toBe(false)
  })
})

describe('getDashboardMenuItems — Door Knocking has no standalone nav item', () => {
  // Door knocking is a channel of Outreach, not a peer of it: the outreach
  // hub's channel tile (`v2/ChannelTileGrid.tsx`) is the only entry, since it's
  // the only one that can carry a saved list across as `?listId=`.
  it('never includes a door-knocking item', () => {
    const items = links({ isElectedOffice: true })
    expect(items.some((i) => i.id === 'door-knocking-dashboard')).toBe(false)
  })
})

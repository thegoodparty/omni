import { describe, expect, it, vi } from 'vitest'
import {
  MANAGED_CIVIC_PANEL_HOW_IT_WORKS,
  managedCivicPanelOneInN,
  type ManagedCivicPanel,
} from '@goodparty_org/contracts'
import type { Organization } from '../../../../generated/prisma'
import type { ManagedCivicPanelService } from '@/contacts/services/managedCivicPanel.service'
import {
  buildManagedCivicPanelTools,
  isManagedPanelSetUp,
  managedPanelTimeline,
} from './managedCivicPanel.tools'

const organization = { slug: 'eo-managed' } as Organization

const panel = (overrides: Partial<ManagedCivicPanel> = {}) =>
  ({
    status: 'building',
    approvedAt: new Date('2026-10-22T18:00:00Z'),
    readyAt: null,
    progress: {
      members: 4,
      goalMembers: 275,
      wavesSent: 1,
      nextWaveAt: new Date('2026-11-03T18:00:00Z'),
    },
    ...overrides,
  }) as ManagedCivicPanel

type Facts = {
  place: string | null
  goalMembers: number
  olderShare: number | null
}

const ASHEVILLE: Facts = {
  place: 'Asheville',
  goalMembers: 275,
  olderShare: 0.21,
}

const toolsFor = (
  found: ManagedCivicPanel | null,
  setUp: boolean,
  facts: Facts = ASHEVILLE,
) => {
  const read = vi.fn(() => Promise.resolve({ panel: found }))
  const explainerFacts = vi.fn(() => Promise.resolve(facts))
  const districtPlace = vi.fn(() => Promise.resolve(facts.place))
  const tools = buildManagedCivicPanelTools({
    panels: {
      read,
      explainerFacts,
      districtPlace,
    } as unknown as ManagedCivicPanelService,
    organization,
    setUp,
  })
  const run = (name: keyof typeof tools, input: object = {}) =>
    (tools[name] as unknown as { execute: (input: object) => unknown }).execute(
      input,
    )
  return { run, read, tools }
}

const explain = async (
  part: 'what_it_is' | 'how_it_works',
  facts: Facts = ASHEVILLE,
): Promise<string> => {
  const result = (await toolsFor(null, false, facts).run(
    'explain_managed_panel',
    { part },
  )) as { text: string }
  return result.text
}

const EXPLANATION = `Your civic panel is a group of Asheville residents, from every age group, neighborhood, gender and race, who've said yes to hearing from your office. Before a big vote, you can ask them and hear from the whole city, not just the people at the podium.

Your part is approving one invite. We gather the residents for you, in your name. It's free in early access.`

const howItWorks = (
  example: string,
) => `We invite residents from every part of Asheville by text, in your name. Anyone who replies JOIN takes a seat.

Your civic panel has 275 seats, split to match Asheville. ${example} The same goes for neighborhoods, gender and race. We keep inviting until every group has its fair share.

When you ask a question, we wait until every group has answered before showing results, so a few loud voices can't tip it. Then we balance the answers so they reflect all of Asheville, not just whoever replied most. That's how a few hundred people can speak for the whole city.

Members hear from your office about once a month, and anyone can text STOP to leave.`

describe('managedPanelTimeline', () => {
  // Approved on a Thursday: three business days out is Tuesday, and the
  // panel is ready about two weeks of waves later.
  it('sends on the earliest Serve send date and is ready two weeks later', () => {
    expect(managedPanelTimeline(new Date('2026-10-22T18:00:00Z'))).toEqual({
      firstSendDate: 'Tuesday, October 27',
      readyWeekOf: 'November 9',
    })
  })
})

describe('isManagedPanelSetUp', () => {
  it('counts any enrollment but a stopped one', () => {
    expect(isManagedPanelSetUp(null)).toBe(false)
    expect(isManagedPanelSetUp(panel())).toBe(true)
    expect(isManagedPanelSetUp(panel({ status: 'stopped' }))).toBe(false)
  })
})

describe('the managed civic panel tools', () => {
  it('offers and shows the invite only before the office sets it up', () => {
    const before = toolsFor(null, false)
    expect(before.run('offer_managed_panel_invite')).toEqual({ offered: true })
    expect(before.run('present_managed_panel_invite')).toEqual({ shown: true })

    const after = toolsFor(panel(), true)
    expect(after.run('offer_managed_panel_invite')).toMatchObject({
      error: expect.stringContaining('Never offer or show the invite again'),
    })
    expect(after.run('present_managed_panel_invite')).toMatchObject({
      error: expect.any(String),
    })
  })

  it('reads where the panel stands, with its dates', async () => {
    expect(await toolsFor(null, false).run('read_managed_panel')).toEqual({
      status: 'not_set_up',
    })
    expect(await toolsFor(panel(), true).run('read_managed_panel')).toEqual({
      status: 'building',
      members: 4,
      goalMembers: 275,
      firstSendDate: 'Tuesday, October 27',
      readyWeekOf: 'November 9',
      nextSendDate: 'Tuesday, November 3',
      readyDate: null,
    })
    expect(
      await toolsFor(panel({ status: 'exhausted', readyAt: null }), true).run(
        'read_managed_panel',
      ),
    ).toMatchObject({ status: 'exhausted' })
  })

  it('shows the panel card only once there is a panel', async () => {
    expect(await toolsFor(panel(), true).run('present_managed_panel')).toEqual({
      shown: true,
    })
    expect(
      await toolsFor(null, false).run('present_managed_panel'),
    ).toMatchObject({ error: expect.any(String) })
  })
})

describe('the civic panel explanation', () => {
  it('writes the approved explanation, naming the place', async () => {
    expect(await explain('what_it_is')).toBe(EXPLANATION)
  })

  it('answers How does it work? with the district’s real numbers', async () => {
    expect(await explain('how_it_works')).toBe(
      howItWorks(
        'If about 1 in 5 residents is 65 or older, about 1 in 5 seats goes to people 65 and older.',
      ),
    )
  })

  it('drops the numbers where the census share is unknown or unfriendly', async () => {
    const fallback = howItWorks(
      'Every age group gets seats in line with its share of Asheville.',
    )
    expect(
      await explain('how_it_works', { ...ASHEVILLE, olderShare: null }),
    ).toBe(fallback)
    expect(
      await explain('how_it_works', { ...ASHEVILLE, olderShare: 0.04 }),
    ).toBe(fallback)
  })

  it('reads without a place where the district has none', async () => {
    const noPlace = { ...ASHEVILLE, place: null }
    expect(await explain('what_it_is', noPlace)).toContain(
      'Your civic panel is a group of residents, from every age group',
    )
    expect(await explain('how_it_works', noPlace)).toContain(
      'split to match your district',
    )
  })

  it('is never offered once the office set it up', async () => {
    expect(
      await toolsFor(panel(), true).run('explain_managed_panel', {
        part: 'what_it_is',
      }),
    ).toMatchObject({ error: expect.any(String) })
  })

  it('says one in N only from 2 to 10', () => {
    expect(managedCivicPanelOneInN(0.21)).toBe('1 in 5')
    expect(managedCivicPanelOneInN(0.5)).toBe('1 in 2')
    expect(managedCivicPanelOneInN(0.1)).toBe('1 in 10')
    expect(managedCivicPanelOneInN(0.8)).toBeNull()
    expect(managedCivicPanelOneInN(0.04)).toBeNull()
    expect(managedCivicPanelOneInN(0)).toBeNull()
  })

  it('never says wave to the official', async () => {
    const said = [
      await explain('what_it_is'),
      await explain('how_it_works'),
      await explain('how_it_works', { ...ASHEVILLE, olderShare: null }),
      await explain('what_it_is', { ...ASHEVILLE, place: null }),
      MANAGED_CIVIC_PANEL_HOW_IT_WORKS,
      JSON.stringify(await toolsFor(panel(), true).run('read_managed_panel')),
      ...Object.values(toolsFor(null, false).tools).map(
        (tool) => (tool as { description: string }).description,
      ),
    ]
    for (const text of said) expect(text).not.toMatch(/wave/i)
  })
})

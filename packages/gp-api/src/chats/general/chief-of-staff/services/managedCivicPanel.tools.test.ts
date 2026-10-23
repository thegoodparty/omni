import { describe, expect, it, vi } from 'vitest'
import type { ManagedCivicPanel } from '@goodparty_org/contracts'
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

const toolsFor = (found: ManagedCivicPanel | null, setUp: boolean) => {
  const read = vi.fn(() => Promise.resolve({ panel: found }))
  const tools = buildManagedCivicPanelTools({
    panels: { read } as unknown as ManagedCivicPanelService,
    organization,
    setUp,
  })
  const run = (name: keyof typeof tools) =>
    (tools[name] as unknown as { execute: () => unknown }).execute()
  return { run, read }
}

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
      wavesSent: 1,
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

  it('shows the join link while the panel takes members', async () => {
    expect(
      await toolsFor(panel({ status: 'exhausted' }), true).run(
        'present_managed_panel_join_link',
      ),
    ).toEqual({ shown: true })
    expect(
      await toolsFor(panel({ status: 'stopped' }), false).run(
        'present_managed_panel_join_link',
      ),
    ).toMatchObject({ error: expect.any(String) })
    expect(
      await toolsFor(null, false).run('present_managed_panel_join_link'),
    ).toMatchObject({ error: expect.any(String) })
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

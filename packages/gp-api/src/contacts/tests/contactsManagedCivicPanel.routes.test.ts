import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { addDays, subDays } from 'date-fns'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  CIVIC_PANEL_JOIN_LINE,
  CIVIC_PANEL_LEAVE_LINE,
  SMS_COMPOSED_MAX_LENGTH,
  type ManagedCivicPanelResponse,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import {
  CivicPanelStatus,
  ContactStatusField,
  ContactStatusSource,
  ManagedCivicPanelStatus,
} from '@/generated/prisma'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { FeaturesService } from '@/features/services/features.service'
import {
  CENSUS_COMPOSITION_SOURCE,
  type CensusCompositionSource,
} from '@/priorities/services/censusComposition'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'
const PATH = '/v1/contacts/civic-panel/managed'

const INVITE = `Hi, it's Mayor Lee. I want to hear from you before I decide.\n\n${CIVIC_PANEL_JOIN_LINE}\n\nReply STOP to opt out.`
const CONSENT = '2026-10-22'

const seedOrg = async (prefix: 'eo' | 'campaign' = 'eo') => {
  const slug = `${prefix}-managed-panel-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id, overrideDistrictId: randomUUID() },
  })
  return slug
}

const headers = (slug: string) => ({ [ORG_SLUG_HEADER]: slug })

const get = (slug: string) =>
  service.client.get<ManagedCivicPanelResponse>(PATH, {
    headers: headers(slug),
    validateStatus: () => true,
  })

const approve = (
  slug: string,
  body: Record<string, unknown> = {
    inviteMessage: INVITE,
    consentVersion: CONSENT,
  },
) =>
  service.client.post<ManagedCivicPanelResponse>(PATH, body, {
    headers: headers(slug),
    validateStatus: () => true,
  })

const act = (slug: string, action: string) =>
  service.client.patch<ManagedCivicPanelResponse>(
    PATH,
    { action },
    { headers: headers(slug), validateStatus: () => true },
  )

const flagOff = () => {
  const flag = vi
    .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
    .mockResolvedValue(false)
  onTestFinished(() => flag.mockRestore())
}

const stubAnswersNeeded = (answers: number | null) => {
  const spy = vi
    .spyOn(
      service.app.get<CensusCompositionSource>(CENSUS_COMPOSITION_SOURCE),
      'districtAnswersNeeded',
    )
    .mockResolvedValue(answers)
  onTestFinished(() => spy.mockRestore())
}

const setStatus = (slug: string, status: ManagedCivicPanelStatus) =>
  service.prisma.managedCivicPanel.update({
    where: { organizationSlug: slug },
    data: { status },
  })

const joinPanel = async (slug: string, count: number) => {
  for (let i = 0; i < count; i++) {
    await service.app.get(ContactStatusService).changeStatus({
      organizationSlug: slug,
      personId: randomUUID(),
      field: ContactStatusField.civic_panel,
      toValue: CivicPanelStatus.member,
      source: ContactStatusSource.manual,
      actorUserId: service.user.id,
      fallbackFromValue: CivicPanelStatus.left,
    })
  }
}

describe('managed civic panel with the flag off', () => {
  it('404s every route', async () => {
    const slug = await seedOrg()
    flagOff()

    expect((await get(slug)).status).toBe(HttpStatus.NOT_FOUND)
    expect((await approve(slug)).status).toBe(HttpStatus.NOT_FOUND)
    expect((await act(slug, 'pause')).status).toBe(HttpStatus.NOT_FOUND)
    expect(
      await service.prisma.managedCivicPanel.count({
        where: { organizationSlug: slug },
      }),
    ).toBe(0)
  })
})

describe('GET /v1/contacts/civic-panel/managed', () => {
  it('reads null before the office approves', async () => {
    const slug = await seedOrg()

    const res = await get(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({ panel: null })
  })

  it('400s for a campaign', async () => {
    const slug = await seedOrg('campaign')

    expect((await get(slug)).status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('reads members, waves sent and the next wave date', async () => {
    const slug = await seedOrg()
    await approve(slug)
    await joinPanel(slug, 3)
    const panel = await service.prisma.managedCivicPanel.findUniqueOrThrow({
      where: { organizationSlug: slug },
    })
    const windowEnds = addDays(new Date(), 2)
    await service.prisma.managedPanelWave.createMany({
      data: [
        {
          enrollmentId: panel.id,
          wave: 1,
          sentAt: subDays(new Date(), 10),
          replyWindowEndsAt: subDays(new Date(), 7),
        },
        {
          enrollmentId: panel.id,
          wave: 2,
          sentAt: subDays(new Date(), 1),
          replyWindowEndsAt: windowEnds,
        },
        { enrollmentId: panel.id, wave: 3 },
      ],
    })

    const res = await get(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.panel?.progress).toEqual({
      members: 3,
      goalMembers: panel.goalMembers,
      wavesSent: 2,
      nextWaveAt: windowEnds.toISOString(),
    })
  })

  it('has no next wave while paused', async () => {
    const slug = await seedOrg()
    await approve(slug)
    const panel = await service.prisma.managedCivicPanel.findUniqueOrThrow({
      where: { organizationSlug: slug },
    })
    await service.prisma.managedPanelWave.create({
      data: {
        enrollmentId: panel.id,
        wave: 1,
        sentAt: new Date(),
        replyWindowEndsAt: addDays(new Date(), 3),
      },
    })
    await act(slug, 'pause')

    const res = await get(slug)

    expect(res.data.panel?.progress.wavesSent).toBe(1)
    expect(res.data.panel?.progress.nextWaveAt).toBeNull()
  })
})

describe('POST /v1/contacts/civic-panel/managed', () => {
  it('approves with the district goal, building, in the official’s name', async () => {
    const slug = await seedOrg()
    // 20 answers at the 40% reply rate: 50 members.
    stubAnswersNeeded(20)

    const res = await approve(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.panel).toMatchObject({
      status: 'building',
      inviteMessage: INVITE,
      consentVersion: CONSENT,
      approvedByUserId: service.user.id,
      goalMembers: 50,
      freeTextCap: 15000,
      freeTextsUsed: 0,
      readyAt: null,
      pausedAt: null,
      stoppedAt: null,
      progress: { members: 0, goalMembers: 50, wavesSent: 0, nextWaveAt: null },
    })
  })

  it('sizes for the most any district needs when the census cannot be read', async () => {
    const slug = await seedOrg()
    stubAnswersNeeded(null)

    const res = await approve(slug)

    expect(res.data.panel?.goalMembers).toBe(250)
  })

  it('returns the existing enrollment on a second approval', async () => {
    const slug = await seedOrg()
    const first = await approve(slug)
    await act(slug, 'pause')

    const second = await approve(slug, {
      inviteMessage: `Another invite.\n\n${CIVIC_PANEL_JOIN_LINE}\n\nReply STOP to opt out.`,
      consentVersion: 'v2',
    })

    expect(first.status).toBe(HttpStatus.OK)
    expect(second.status).toBe(HttpStatus.OK)
    expect(second.data.panel?.id).toBe(first.data.panel?.id)
    expect(second.data.panel).toMatchObject({
      status: 'paused',
      inviteMessage: INVITE,
      consentVersion: CONSENT,
    })
    expect(
      await service.prisma.managedCivicPanel.count({
        where: { organizationSlug: slug },
      }),
    ).toBe(1)
  })

  it('approves a stopped enrollment again', async () => {
    const slug = await seedOrg()
    const first = await approve(slug)
    await service.prisma.managedCivicPanel.update({
      where: { organizationSlug: slug },
      data: { freeTextsUsed: 4000 },
    })
    await act(slug, 'stop')
    const newInvite = `Another invite.\n\n${CIVIC_PANEL_JOIN_LINE}\n\nReply STOP to opt out.`

    const res = await approve(slug, {
      inviteMessage: newInvite,
      consentVersion: 'v2',
    })

    expect(res.data.panel?.id).toBe(first.data.panel?.id)
    expect(res.data.panel).toMatchObject({
      status: 'building',
      inviteMessage: newInvite,
      consentVersion: 'v2',
      stoppedAt: null,
      freeTextsUsed: 4000,
    })
  })

  it('400s an invite without the JOIN line', async () => {
    const slug = await seedOrg()

    const res = await approve(slug, {
      inviteMessage: 'Hi, it’s Mayor Lee.\n\nReply STOP to opt out.',
      consentVersion: CONSENT,
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect((await get(slug)).data.panel).toBeNull()
  })

  it('400s an invite with an older wording of the JOIN line', async () => {
    const slug = await seedOrg()

    const res = await approve(slug, {
      inviteMessage: `Hi.\n\nReply JOIN to join my citizens' panel. My office will text you about once a month to ask what you think before I decide. Empowered by GoodParty.org.\n\nReply STOP to opt out.`,
      consentVersion: CONSENT,
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('400s an invite without the STOP opt-out', async () => {
    const slug = await seedOrg()

    const res = await approve(slug, {
      inviteMessage: `Hi, it's Mayor Lee.\n\n${CIVIC_PANEL_JOIN_LINE}`,
      consentVersion: CONSENT,
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(res.data).toMatchObject({
      message: expect.stringContaining('opt-out'),
    })
  })

  it('400s an invite with the JOIN line twice or a LEAVE line', async () => {
    const slug = await seedOrg()

    const twice = await approve(slug, {
      inviteMessage: `${CIVIC_PANEL_JOIN_LINE}\n\n${CIVIC_PANEL_JOIN_LINE}\n\nReply STOP to opt out.`,
      consentVersion: CONSENT,
    })
    const leave = await approve(slug, {
      inviteMessage: `${CIVIC_PANEL_JOIN_LINE}\n\n${CIVIC_PANEL_LEAVE_LINE}\n\nReply STOP to opt out.`,
      consentVersion: CONSENT,
    })

    expect(twice.status).toBe(HttpStatus.BAD_REQUEST)
    expect(leave.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('400s an invite past the composed SMS length', async () => {
    const slug = await seedOrg()
    const padding = 'a'.repeat(SMS_COMPOSED_MAX_LENGTH)

    const res = await approve(slug, {
      inviteMessage: `${padding}\n\n${CIVIC_PANEL_JOIN_LINE}\n\nReply STOP to opt out.`,
      consentVersion: CONSENT,
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('400s a body with unknown keys or no consent', async () => {
    const slug = await seedOrg()

    const extra = await approve(slug, {
      inviteMessage: INVITE,
      consentVersion: CONSENT,
      freeTextCap: 1_000_000,
    })
    const noConsent = await approve(slug, { inviteMessage: INVITE })

    expect(extra.status).toBe(HttpStatus.BAD_REQUEST)
    expect(noConsent.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('400s for a campaign', async () => {
    const slug = await seedOrg('campaign')

    expect((await approve(slug)).status).toBe(HttpStatus.BAD_REQUEST)
  })
})

describe('PATCH /v1/contacts/civic-panel/managed', () => {
  const VALID: [ManagedCivicPanelStatus, string, ManagedCivicPanelStatus][] = [
    ['building', 'pause', 'paused'],
    ['paused', 'resume', 'building'],
    ['building', 'stop', 'stopped'],
    ['paused', 'stop', 'stopped'],
    ['ready', 'stop', 'stopped'],
  ]

  it.each(VALID)('moves %s on %s to %s', async (from, action, to) => {
    const slug = await seedOrg()
    await approve(slug)
    await setStatus(slug, from)

    const res = await act(slug, action)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.panel?.status).toBe(to)
  })

  const INVALID: [ManagedCivicPanelStatus, string][] = [
    ['paused', 'pause'],
    ['ready', 'pause'],
    ['stopped', 'pause'],
    ['building', 'resume'],
    ['ready', 'resume'],
    ['stopped', 'resume'],
    ['stopped', 'stop'],
  ]

  it.each(INVALID)(
    '409s %s on %s and changes nothing',
    async (from, action) => {
      const slug = await seedOrg()
      await approve(slug)
      await setStatus(slug, from)

      const res = await act(slug, action)

      expect(res.status).toBe(HttpStatus.CONFLICT)
      expect((await get(slug)).data.panel?.status).toBe(from)
    },
  )

  it('stamps pausedAt on pause and clears it on resume', async () => {
    const slug = await seedOrg()
    await approve(slug)

    const paused = await act(slug, 'pause')
    const resumed = await act(slug, 'resume')

    expect(paused.data.panel?.pausedAt).not.toBeNull()
    expect(resumed.data.panel?.pausedAt).toBeNull()
  })

  it('stamps stoppedAt on stop', async () => {
    const slug = await seedOrg()
    await approve(slug)

    const res = await act(slug, 'stop')

    expect(res.data.panel?.stoppedAt).not.toBeNull()
  })

  it('404s with no enrollment', async () => {
    const slug = await seedOrg()

    expect((await act(slug, 'pause')).status).toBe(HttpStatus.NOT_FOUND)
  })

  it('400s an unknown action', async () => {
    const slug = await seedOrg()
    await approve(slug)

    expect((await act(slug, 'finish')).status).toBe(HttpStatus.BAD_REQUEST)
  })
})

describe('managed civic panel org scoping', () => {
  it('never reads or changes another office’s enrollment', async () => {
    const mine = await seedOrg()
    const sibling = await seedOrg()
    await approve(sibling)

    expect((await get(mine)).data).toEqual({ panel: null })
    expect((await act(mine, 'stop')).status).toBe(HttpStatus.NOT_FOUND)
    expect((await get(sibling)).data.panel?.status).toBe('building')
  })

  it('refuses an office the user is not a member of', async () => {
    const otherUser = await service.prisma.user.create({
      data: { email: `managed-panel-${randomUUID()}@example.com` },
    })
    const theirs = `eo-managed-panel-${randomUUID()}`
    await service.prisma.organization.create({
      data: { slug: theirs, ownerId: otherUser.id },
    })
    await service.prisma.managedCivicPanel.create({
      data: {
        organizationSlug: theirs,
        inviteMessage: INVITE,
        consentVersion: CONSENT,
        approvedAt: new Date(),
        approvedByUserId: otherUser.id,
        goalMembers: 250,
      },
    })

    expect((await get(theirs)).status).toBe(HttpStatus.NOT_FOUND)
    expect((await act(theirs, 'stop')).status).toBe(HttpStatus.NOT_FOUND)
    expect((await approve(theirs)).status).toBe(HttpStatus.NOT_FOUND)
    const row = await service.prisma.managedCivicPanel.findUniqueOrThrow({
      where: { organizationSlug: theirs },
    })
    expect(row.status).toBe(ManagedCivicPanelStatus.building)
  })
})

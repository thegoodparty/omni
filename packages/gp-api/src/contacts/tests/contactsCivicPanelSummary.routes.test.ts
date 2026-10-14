import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { subDays } from 'date-fns'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type {
  CivicPanelRepresentation,
  CivicPanelSummary,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import {
  CivicPanelStatus,
  ContactStatusField,
  ContactStatusSource,
} from '@/generated/prisma'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { ContactsMadeResolutionService } from '@/contactInteraction/services/contactsMadeResolution.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { FeaturesService } from '@/features/services/features.service'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'

const seedOrg = async (prefix: 'eo' | 'campaign') => {
  const slug = `${prefix}-civic-panel-summary-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id, overrideDistrictId: randomUUID() },
  })
  return slug
}

const setPanel = (
  organizationSlug: string,
  personId: string,
  toValue: CivicPanelStatus,
) =>
  service.app.get(ContactStatusService).changeStatus({
    organizationSlug,
    personId,
    field: ContactStatusField.civic_panel,
    toValue,
    source: ContactStatusSource.manual,
    actorUserId: service.user.id,
    fallbackFromValue: CivicPanelStatus.left,
  })

const textedDaysAgo = (
  organizationSlug: string,
  personId: string,
  days: number,
) =>
  service.prisma.contactInteractionText.create({
    data: {
      organizationSlug,
      personId,
      occurredAt: subDays(new Date(), days),
      manual: true,
    },
  })

const get = <T>(path: string, slug: string) =>
  service.client.get<T>(path, {
    headers: { [ORG_SLUG_HEADER]: slug },
    validateStatus: () => true,
  })

const summary = (slug: string) =>
  get<CivicPanelSummary>('/v1/contacts/civic-panel', slug)

const representation = (slug: string) =>
  get<CivicPanelRepresentation>('/v1/contacts/civic-panel/representation', slug)

const flagOff = () => {
  const flag = vi
    .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
    .mockResolvedValue(false)
  onTestFinished(() => flag.mockRestore())
}

describe('GET /v1/contacts/civic-panel', () => {
  it('reads an empty panel as zeros', async () => {
    const slug = await seedOrg('eo')

    const res = await summary(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({ members: 0, reachedRecently: 0, askableNow: 0 })
  })

  it('counts a member reached 10 days ago as reached and 40 days ago as askable', async () => {
    const slug = await seedOrg('eo')
    const recent = randomUUID()
    const rested = randomUUID()
    const untouched = randomUUID()
    const left = randomUUID()
    const notOnPanel = randomUUID()
    for (const id of [recent, rested, untouched, left]) {
      await setPanel(slug, id, CivicPanelStatus.member)
    }
    await setPanel(slug, left, CivicPanelStatus.left)
    await textedDaysAgo(slug, recent, 10)
    await textedDaysAgo(slug, rested, 40)
    await textedDaysAgo(slug, left, 5)
    await textedDaysAgo(slug, notOnPanel, 5)

    const res = await summary(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({ members: 3, reachedRecently: 1, askableNow: 2 })
  })

  it("does not count another office's outreach as reaching a member", async () => {
    const slug = await seedOrg('eo')
    const other = await seedOrg('eo')
    const member = randomUUID()
    await setPanel(slug, member, CivicPanelStatus.member)
    await textedDaysAgo(other, member, 3)

    const res = await summary(slug)

    expect(res.data).toEqual({ members: 1, reachedRecently: 0, askableNow: 1 })
  })

  it("still counts when the office's contacted set is past the list filter's cap", async () => {
    const slug = await seedOrg('eo')
    const recent = randomUUID()
    const rested = randomUUID()
    await setPanel(slug, recent, CivicPanelStatus.member)
    await setPanel(slug, rested, CivicPanelStatus.member)
    await textedDaysAgo(slug, recent, 2)
    await textedDaysAgo(slug, rested, 45)
    // What the whole-set read does past MAX_RESOLVED_ID_SET_SIZE.
    const wholeSet = vi
      .spyOn(
        service.app.get(ContactsMadeResolutionService),
        'personIdsContactedSince',
      )
      .mockRejectedValue(new Error('resolves too many people'))
    onTestFinished(() => wholeSet.mockRestore())

    const res = await summary(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({ members: 2, reachedRecently: 1, askableNow: 1 })
  })

  it('400s for a Win org', async () => {
    const slug = await seedOrg('campaign')
    await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${slug}-campaign`,
        organizationSlug: slug,
        isPro: true,
        details: {},
      },
    })

    const res = await summary(slug)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('404s with serve-citizen-panels off', async () => {
    const slug = await seedOrg('eo')
    flagOff()

    const res = await summary(slug)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('GET /v1/contacts/civic-panel/representation', () => {
  const stubPoints = () =>
    vi
      .spyOn(service.app.get(ContactsService), 'pointsForPeople')
      .mockImplementation(async (ids) => ({
        points: ids.map((id, index) => ({
          id,
          lat: 35.59 + index * 0.0101234,
          lng: -82.55 - index * 0.0101234,
        })),
        truncated: false,
      }))

  it('compares the members with the district', async () => {
    const slug = await seedOrg('eo')
    const points = stubPoints()
    const members = Array.from({ length: 12 }, () => randomUUID())
    for (const id of members) await setPanel(slug, id, CivicPanelStatus.member)
    const left = randomUUID()
    await setPanel(slug, left, CivicPanelStatus.member)
    await setPanel(slug, left, CivicPanelStatus.left)

    const res = await representation(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(points.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(members))
    expect(points.mock.calls[0]?.[0]).not.toContain(left)
    expect(res.data.representation).toMatchObject({
      source: 'sample',
      respondentCount: 12,
    })
    expect(res.data.representation?.groups.length).toBeGreaterThan(0)
  })

  it('draws a truncated map read from the members it returned', async () => {
    const slug = await seedOrg('eo')
    const members = Array.from({ length: 15 }, () => randomUUID())
    for (const id of members) await setPanel(slug, id, CivicPanelStatus.member)
    const points = vi
      .spyOn(service.app.get(ContactsService), 'pointsForPeople')
      .mockImplementation(async (ids) => ({
        points: ids.slice(0, 11).map((id, index) => ({
          id,
          lat: 35.59 + index * 0.0101234,
          lng: -82.55 - index * 0.0101234,
        })),
        truncated: true,
      }))
    onTestFinished(() => points.mockRestore())

    const res = await representation(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.representation?.respondentCount).toBe(11)
    expect(res.data.representation?.groups.length).toBeGreaterThan(0)
  })

  it('withholds the comparison below the minimum number of members', async () => {
    const slug = await seedOrg('eo')
    const points = stubPoints()
    for (let i = 0; i < 3; i++) {
      await setPanel(slug, randomUUID(), CivicPanelStatus.member)
    }

    const res = await representation(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.representation).toBeNull()
    expect(points).not.toHaveBeenCalled()
  })

  it('404s with serve-citizen-panels off', async () => {
    const slug = await seedOrg('eo')
    flagOff()

    const res = await representation(slug)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

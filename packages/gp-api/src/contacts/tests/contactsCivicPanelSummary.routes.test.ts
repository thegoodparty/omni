import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { subDays } from 'date-fns'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { CivicPanelSummary } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import {
  CivicPanelStatus,
  ContactStatusField,
  ContactStatusSource,
  ManagedCivicPanelStatus,
} from '@/generated/prisma'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { ContactsMadeResolutionService } from '@/contactInteraction/services/contactsMadeResolution.service'
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

const seedManaged = (
  organizationSlug: string,
  goalMembers: number,
  status: ManagedCivicPanelStatus,
) =>
  service.prisma.managedCivicPanel.create({
    data: {
      organizationSlug,
      status,
      inviteMessage:
        'Reply JOIN to join my civic panel. Reply STOP to opt out.',
      consentVersion: 'test',
      approvedAt: new Date(),
      approvedByUserId: service.user.id,
      goalMembers,
    },
  })

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
    expect(res.data).toMatchObject({
      members: 0,
      reachedRecently: 0,
      askableNow: 0,
      lastOutreachAt: null,
      progress: { members: 0, expectedAnswers: 0, groupsCovered: 0 },
      balance: { status: 'tooFewMembers', inviteMore: null },
      composition: null,
    })
    expect(res.data.progress.goal).toBeGreaterThan(0)
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
    expect(res.data).toMatchObject({
      members: 3,
      reachedRecently: 1,
      askableNow: 2,
      lastOutreachAt: null,
    })
  })

  it("does not count another office's outreach as reaching a member", async () => {
    const slug = await seedOrg('eo')
    const other = await seedOrg('eo')
    const member = randomUUID()
    await setPanel(slug, member, CivicPanelStatus.member)
    await textedDaysAgo(other, member, 3)

    const res = await summary(slug)

    expect(res.data).toMatchObject({
      members: 1,
      reachedRecently: 0,
      askableNow: 1,
      lastOutreachAt: null,
    })
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
    expect(res.data).toMatchObject({
      members: 2,
      reachedRecently: 1,
      askableNow: 1,
      lastOutreachAt: null,
    })
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
  it("counts toward a managed civic panel's stored goal while it runs", async () => {
    const districtGoal = (await summary(await seedOrg('eo'))).data.progress.goal
    const slug = await seedOrg('eo')
    await seedManaged(slug, districtGoal - 3, ManagedCivicPanelStatus.building)

    const res = await summary(slug)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.progress.goal).toBe(districtGoal - 3)
  })

  it('keeps the managed goal once the managed civic panel is ready', async () => {
    const slug = await seedOrg('eo')
    await seedManaged(slug, 2, ManagedCivicPanelStatus.ready)

    const res = await summary(slug)

    expect(res.data.progress.goal).toBe(2)
  })

  it("goes back to the district's goal once the managed civic panel is stopped", async () => {
    const districtGoal = (await summary(await seedOrg('eo'))).data.progress.goal
    const slug = await seedOrg('eo')
    await seedManaged(slug, districtGoal - 3, ManagedCivicPanelStatus.stopped)

    const res = await summary(slug)

    expect(res.data.progress.goal).toBe(districtGoal)
  })
})

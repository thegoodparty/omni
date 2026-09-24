import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { Campaign, OutreachType } from '../../generated/prisma'

const service = useTestService()

let campaign: Campaign
let orgSlug: string

beforeEach(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  orgSlug = `campaign-archive-${suffix}`

  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })

  campaign = await service.prisma.campaign.create({
    data: {
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: `archive-campaign-${suffix}`,
      details: {},
      data: {},
      aiContent: {},
    },
  })
})

const orgHeaders = (slug = orgSlug) => ({
  headers: { 'x-organization-slug': slug },
})

const createOutreach = () =>
  service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: OutreachType.nativePhoneBanking,
      name: 'GOTV calls',
    },
  })

// A pre-VO-2.0 row: campaign-scoped, with no `organizationSlug` of its own.
// The schema says these resolve their org through the campaign join and are
// deliberately not backfilled, so the archive scope has to follow that join
// or every one of them 404s.
const createLegacyOutreach = () =>
  service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: null,
      outreachType: OutreachType.text,
      name: 'Legacy request',
    },
  })

describe('PATCH /v1/outreach/:id/archive', () => {
  it('stamps archivedAt when archiving', async () => {
    const outreach = await createOutreach()

    const res = await service.client.patch(
      `/v1/outreach/${outreach.id}/archive`,
      { archived: true },
      orgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.id).toBe(outreach.id)
    expect(res.data.archivedAt).not.toBeNull()

    const persisted = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreach.id },
    })
    expect(persisted.archivedAt).not.toBeNull()
  })

  // The bug this endpoint had for every legacy row: scoping on the column
  // alone matched nothing, so a request submitted before VO 2.0 and never
  // fulfilled could not be archived from anywhere.
  it('archives a legacy row that carries no organizationSlug', async () => {
    const legacy = await createLegacyOutreach()

    const res = await service.client.patch(
      `/v1/outreach/${legacy.id}/archive`,
      { archived: true },
      orgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.archivedAt).not.toBeNull()
    const persisted = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: legacy.id },
    })
    expect(persisted.archivedAt).not.toBeNull()
  })

  // The join widens the scope, so what matters is that it does not widen the
  // TENANT: a legacy row still has to hang off a campaign in the caller's org.
  it('refuses a legacy row belonging to another organization', async () => {
    const legacy = await createLegacyOutreach()
    const otherSlug = `campaign-archive-outsider-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        organizationSlug: otherSlug,
        userId: service.user.id,
        slug: `${otherSlug}-campaign`,
        details: {},
        data: {},
        aiContent: {},
      },
    })

    const res = await service.client.patch(
      `/v1/outreach/${legacy.id}/archive`,
      { archived: true },
      { ...orgHeaders(otherSlug), validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    const persisted = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: legacy.id },
    })
    expect(persisted.archivedAt).toBeNull()
  })

  it('clears archivedAt on restore', async () => {
    const created = await createOutreach()
    await service.prisma.outreach.update({
      where: { id: created.id },
      data: { archivedAt: new Date() },
    })

    const res = await service.client.patch(
      `/v1/outreach/${created.id}/archive`,
      { archived: false },
      orgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.archivedAt).toBeNull()

    const persisted = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: created.id },
    })
    expect(persisted.archivedAt).toBeNull()
  })

  it('404s for an outreach row belonging to another organization and leaves it intact', async () => {
    const outreach = await createOutreach()
    const otherSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const otherSlug = `campaign-archive-other-${otherSuffix}`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    await service.prisma.campaign.create({
      data: {
        organizationSlug: otherSlug,
        userId: service.user.id,
        slug: `archive-other-campaign-${otherSuffix}`,
        details: {},
        data: {},
        aiContent: {},
      },
    })

    const res = await service.client.patch(
      `/v1/outreach/${outreach.id}/archive`,
      { archived: true },
      { ...orgHeaders(otherSlug), validateStatus: () => true },
    )

    expect(res.status).toBe(404)
    const persisted = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: outreach.id },
    })
    expect(persisted.archivedAt).toBeNull()
  })
})
